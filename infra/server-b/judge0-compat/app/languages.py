"""Judge0 language IDs -> Piston runtimes.

The IDs are the ones the product offers (apps/web/.../CodePlayground/languages.ts)
plus a few older/newer Judge0 CE IDs for the same languages. Where the product's
meaning of an ID differs from Judge0 CE (91 is PowerShell in the product, Java 17
in Judge0 1.13), the product wins: the API only ever sends the product's IDs.

`filename` is the name of the main file in the sandbox. Several Piston recipes
append the extension themselves (c, c++, typescript, kotlin, go, java,
haskell), so those names have none.

`unavailable` marks languages the product lists that cannot run on the arm64
host; the adapter answers them with status 13 and this message.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Language:
    id: int
    name: str
    piston_language: str = ""
    piston_version: str = ""
    filename: str = ""
    unavailable: str = ""  # reason; non-empty => status 13, nothing is run
    sql: bool = False  # Judge0 "SQL (SQLite)": run through a Python wrapper


def _l(id_, name, lang="", ver="", filename="", unavailable="", sql=False):
    return Language(id_, name, lang, ver, filename, unavailable, sql)


_ARM = "is not available on this server (the code runner is arm64)"

LANGUAGES: dict[int, Language] = {
    lang.id: lang
    for lang in [
        _l(71, "Python (3.12.0)", "python", "3.12.0", "main.py"),
        _l(63, "JavaScript (Node.js 18.15.0)", "javascript", "18.15.0", "main.js"),
        _l(74, "TypeScript (5.0.3)", "typescript", "5.0.3", "main"),
        _l(62, "Java (OpenJDK 15.0.2)", "java", "15.0.2", "Main"),
        _l(50, "C (GCC 10.2.0)", "c", "10.2.0", "main"),
        _l(54, "C++ (GCC 10.2.0)", "c++", "10.2.0", "main"),
        _l(59, "Fortran (GFortran 10.2.0)", "fortran", "10.2.0", "main.code"),
        _l(73, "Rust (1.68.2)", "rust", "1.68.2", "main.rs"),
        _l(60, "Go (1.16.2)", "go", "1.16.2", "main"),
        _l(68, "PHP (8.2.3)", "php", "8.2.3", "main.php"),
        _l(72, "Ruby (3.0.1)", "ruby", "3.0.1", "main.rb"),
        _l(78, "Kotlin (1.8.20)", "kotlin", "1.8.20", "main"),
        _l(81, "Scala (3.2.2)", "scala", "3.2.2", "Main.scala"),
        _l(85, "Perl (5.36.0)", "perl", "5.36.0", "main.pl"),
        _l(80, "R (4.1.1)", "rscript", "4.1.1", "main.r"),
        _l(90, "Dart (2.19.6)", "dart", "2.19.6", "main.dart"),
        _l(61, "Haskell", unavailable=f"Haskell (GHC) {_ARM}"),
        _l(64, "Lua (5.4.4)", "lua", "5.4.4", "main.lua"),
        _l(57, "Elixir (1.11.3)", "elixir", "1.11.3", "main.exs"),
        _l(86, "Clojure (1.10.3)", "clojure", "1.10.3", "main.clj"),
        _l(46, "Bash (5.2.0)", "bash", "5.2.0", "script.sh"),
        _l(77, "Pascal (FPC 3.2.2)", "pascal", "3.2.2", "main.pas"),
        _l(69, "Prolog (SWI-Prolog 8.2.4)", "prolog", "8.2.4", "main.pl"),
        _l(55, "Common Lisp (SBCL 2.1.2)", "lisp", "2.1.2", "main.lisp"),
        _l(91, "PowerShell (7.1.4)", "powershell", "7.1.4", "main.ps1"),
        _l(51, "C#", unavailable=f"C# (Mono/.NET) {_ARM}"),
        _l(82, "SQL (SQLite via Python 3.12.0)", "python", "3.12.0", "main.py", sql=True),
        # Listed by the product, cannot run here
        _l(45, "Assembly (NASM)", unavailable=f"x86-64 assembly {_ARM}"),
        _l(79, "Objective-C", unavailable=f"Objective-C (Clang + GNUstep) {_ARM}"),
        _l(83, "Swift", unavailable=f"Swift {_ARM}"),
        # Other Judge0 CE IDs for the same runtimes
        _l(48, "C (GCC 7.4.0)", "c", "10.2.0", "main"),
        _l(49, "C (GCC 8.3.0)", "c", "10.2.0", "main"),
        _l(75, "C (Clang 7.0.1)", "c", "10.2.0", "main"),
        _l(52, "C++ (GCC 7.4.0)", "c++", "10.2.0", "main"),
        _l(53, "C++ (GCC 8.3.0)", "c++", "10.2.0", "main"),
        _l(76, "C++ (Clang 7.0.1)", "c++", "10.2.0", "main"),
        _l(92, "Python (3.11.2)", "python", "3.12.0", "main.py"),
        _l(100, "Python (3.12.5)", "python", "3.12.0", "main.py"),
        _l(93, "JavaScript (Node.js 18.15.0)", "javascript", "18.15.0", "main.js"),
        _l(94, "TypeScript (5.0.3)", "typescript", "5.0.3", "main"),
        _l(95, "Go (1.18.5)", "go", "1.16.2", "main"),
    ]
}


def get_language(language_id: int) -> Language | None:
    return LANGUAGES.get(language_id)
