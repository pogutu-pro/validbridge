#!/usr/bin/env python3
"""Smoke test for the deployed adapter. Run ON SERVER B:

    sudo python3 smoke-test.py [--langs-only]

Reads the token from /etc/validbridge/judge0-compat.env (never prints it) and
calls http://10.66.0.2:2358 exactly like the ValidBridge API does.
"""

import base64
import concurrent.futures as cf
import io
import json
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

URL = "http://10.66.0.2:2358"
TOKEN = [l.split("=", 1)[1].strip() for l in open("/etc/validbridge/judge0-compat.env") if l.startswith("JUDGE0_COMPAT_TOKEN=")][0]


def post(body, token=TOKEN, url=URL, timeout=30):
    req = urllib.request.Request(f"{url}/submissions?wait=true", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "X-Judge0-Client-Secret": token})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None


HELLO = {
    71: 'print("hello " + input())',
    63: 'const l=require("fs").readFileSync(0,"utf8").trim();console.log("hello "+l)',
    74: 'declare const require: any;\nconst l: string = require("fs").readFileSync(0,"utf8").trim(); console.log("hello " + l)',
    62: 'import java.util.Scanner;\npublic class Main { public static void main(String[] a) { System.out.println("hello " + new Scanner(System.in).nextLine()); } }',
    50: '#include <stdio.h>\nint main(){char s[64];scanf("%63s",s);printf("hello %s\\n",s);return 0;}',
    54: '#include <iostream>\n#include <string>\nint main(){std::string s;std::cin>>s;std::cout<<"hello "<<s<<"\\n";}',
    59: 'program main\n  character(len=32) :: s\n  read(*,*) s\n  print "(A)", "hello " // trim(s)\nend program main',
    73: 'use std::io;\nfn main(){let mut s=String::new();io::stdin().read_line(&mut s).unwrap();println!("hello {}",s.trim());}',
    60: 'package main\nimport "fmt"\nfunc main(){var s string;fmt.Scan(&s);fmt.Println("hello "+s)}',
    68: '<?php echo "hello " . trim(fgets(STDIN)) . "\\n";',
    72: 'puts "hello " + gets.strip',
    78: 'fun main() { println("hello " + readLine()!!.trim()) }',
    81: 'object Main extends App { println("hello " + scala.io.StdIn.readLine().trim) }',
    85: 'my $s = <STDIN>; chomp $s; print "hello $s\\n";',
    80: 'con <- file("stdin"); s <- readLines(con, n=1); cat("hello", s, "\\n")',
    90: 'import "dart:io";\nvoid main(){print("hello " + stdin.readLineSync()!.trim());}',
    64: 'print("hello " .. io.read())',
    57: 'IO.puts "hello " <> String.trim(IO.gets(""))',
    86: '(println (str "hello " (read-line)))',
    46: 'read s; echo "hello $s"',
    77: 'program Main; var s: string; begin readln(s); writeln(\'hello \', s); end.',
    69: ':- initialization(main).\nmain :- read_term(user_input, _, []), write(\'hello world\'), nl, halt.',
    55: '(format t "hello ~a~%" (read-line))',
    91: '$s = [Console]::In.ReadLine(); Write-Output "hello $s"',
}
STDIN = "world"


def langs():
    rows = []
    for lid, src in HELLO.items():
        t = time.time()
        code, r = post({"language_id": lid, "source_code": src, "stdin": STDIN + ("." if lid == 69 else "") + "\n"})
        dt = time.time() - t
        ok = code == 201 and r["status"]["id"] == 3 and (r["stdout"] or "").strip() == "hello world"
        detail = "" if ok else f" -> http {code} status {r and r['status']} msg {r and r.get('message')} out {r and (r.get('stdout') or '')[:60]!r} err {r and ((r.get('stderr') or '') + (r.get('compile_output') or ''))[:200]!r}"
        rows.append(ok)
        print(f"{'PASS' if ok else 'FAIL'} lang {lid:>3} {dt:5.1f}s{detail}")
    for lid in (45, 79, 83, 51, 61):
        code, r = post({"language_id": lid, "source_code": "x"})
        print(f"{'PASS' if r and r['status']['id'] == 13 else 'FAIL'} lang {lid:>3} unavailable -> 13: {r and r.get('message')}")
    return all(rows)


def check(name, cond, r=None):
    print(f"{'PASS' if cond else 'FAIL'} {name}" + ("" if cond else f" -> {r}"))
    return cond


def cases():
    res = []
    code, _ = post({"language_id": 71, "source_code": "print(1)"}, token="wrong")
    res.append(check("401 with a wrong token", code == 401))
    code, _ = post({"language_id": 71, "source_code": "print(1)"}, token="")
    res.append(check("401 without a token", code == 401))
    try:
        post({"language_id": 71, "source_code": "print(1)"}, url="http://84.12.69.88:2358", timeout=5)
        res.append(check("port 2358 closed on the public IP", False))
    except Exception as e:  # noqa: BLE001
        res.append(check(f"port 2358 closed on the public IP ({type(e).__name__})", True))
    _, r = post({"language_id": 50, "source_code": "int main(){ return x; }"})
    res.append(check("compile error -> 6", r["status"]["id"] == 6 and "error" in (r["compile_output"] or ""), r))
    _, r = post({"language_id": 62, "source_code": "public class Main { public static void main(String[] a) { int x = } }"})
    res.append(check("java compile error -> 6", r["status"]["id"] == 6, r))
    _, r = post({"language_id": 71, "source_code": "while True: pass"})
    res.append(check("timeout -> 5", r["status"]["id"] == 5, r))
    _, r = post({"language_id": 71, "source_code": "print(2)", "expected_output": "3"})
    res.append(check("expected_output mismatch -> 4", r["status"]["id"] == 4, r))
    _, r = post({"language_id": 71, "source_code": "print(3)", "expected_output": "3\n"})
    res.append(check("expected_output match -> 3", r["status"]["id"] == 3, r))
    _, r = post({"language_id": 71, "source_code": "x = bytearray(1024*1024*1024)\nprint(len(x))"})
    res.append(check(f"memory limit -> 12 ({r['message']})", r["status"]["id"] in (11, 12) and not r["stdout"], r))
    _, r = post({"language_id": 50, "source_code": "int main(){int *p=0; return *p;}"})
    res.append(check("segfault -> 7", r["status"]["id"] == 7, r))
    _, r = post({"language_id": 71, "source_code": "import sys; sys.exit(3)"})
    res.append(check("exit 3 -> 11", r["status"]["id"] == 11, r))
    _, r = post({"language_id": 71, "source_code": "import urllib.request\nurllib.request.urlopen('http://1.1.1.1', timeout=2)"})
    res.append(check("no network in sandbox", r["status"]["id"] != 3, r))

    # additional_files exactly as the API builds them (SQL on a SQLite db + a text file)
    with tempfile.NamedTemporaryFile(suffix=".db") as f:
        c = sqlite3.connect(f.name)
        c.executescript("CREATE TABLE s(name TEXT, score INT); INSERT INTO s VALUES('ann',90),('bob',75);")
        c.commit(); c.close()
        db = open(f.name, "rb").read()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("db.sqlite3", db)
        zf.writestr("notes.txt", "extra file\n")
    add = base64.b64encode(buf.getvalue()).decode()
    sql = "SELECT name, score FROM s WHERE score > 80;"
    api_wrapper = ("import sqlite3, base64\n\nsql = base64.b64decode('" + base64.b64encode(sql.encode()).decode() + "').decode()\n"
                   "conn = sqlite3.connect('db.sqlite3')\ncursor = conn.cursor()\n\nfor statement in sql.strip().split(';'):\n"
                   "    statement = statement.strip()\n    if not statement:\n        continue\n    cursor.execute(statement)\n"
                   "    if cursor.description:\n        cols = [d[0] for d in cursor.description]\n        print('|'.join(cols))\n"
                   "        for row in cursor.fetchall():\n            print('|'.join(str(v) for v in row))\n\nconn.close()\n")
    _, r = post({"language_id": 71, "source_code": api_wrapper, "stdin": "", "additional_files": add})
    res.append(check("API SQL path (71 + db.sqlite3 zip)", r["status"]["id"] == 3 and r["stdout"] == "name|score\nann|90\n", r))
    _, r = post({"language_id": 71, "source_code": "print(open('notes.txt').read().strip())", "additional_files": add})
    res.append(check("additional text file readable", (r["stdout"] or "").strip() == "extra file", r))
    _, r = post({"language_id": 82, "source_code": sql, "additional_files": add})
    res.append(check("language 82 (sqlite3-shell style) with db", r["status"]["id"] == 3 and r["stdout"] == "ann|90\n", r))
    _, r = post({"language_id": 50, "source_code": '#include <stdio.h>\nint main(){FILE*f=fopen("notes.txt","r");char b[32];fgets(b,32,f);printf("%s",b);}', "additional_files": add})
    res.append(check("additional files with a compiled language", (r["stdout"] or "") == "extra file\n", r))

    # 10 parallel submissions
    t = time.time()
    with cf.ThreadPoolExecutor(10) as ex:
        outs = list(ex.map(lambda i: post({"language_id": 71, "source_code": f"print({i}*2)"}), range(10)))
    ok = all(c == 201 and r["status"]["id"] == 3 and r["stdout"] == f"{i*2}\n" for i, (c, r) in enumerate(outs))
    res.append(check(f"10 parallel python submissions ({time.time() - t:.1f}s)", ok, outs))
    # A batch like the API's (8 in flight) of Java runs
    t = time.time()
    with cf.ThreadPoolExecutor(8) as ex:
        outs = list(ex.map(lambda i: post({"language_id": 62, "source_code": HELLO[62], "stdin": "world\n"}), range(8)))
    ok = all(c == 201 and r["status"]["id"] == 3 for c, r in outs)
    res.append(check(f"8 parallel java submissions ({time.time() - t:.1f}s)", ok, [o[1]["status"] for o in outs]))
    return all(res)


if __name__ == "__main__":
    a = langs() if "--cases-only" not in sys.argv else True
    b = cases() if "--langs-only" not in sys.argv else True
    sys.exit(0 if a and b else 1)
