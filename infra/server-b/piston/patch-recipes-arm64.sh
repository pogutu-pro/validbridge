#!/usr/bin/env bash
# Rewrite Piston package recipes (packages/<lang>/<ver>/) so they build on
# linux/arm64. Idempotent: safe to run again. Called by build-arm64.sh.
#
# Upstream recipes download x86-64 binaries or assume x86 paths. Each block
# below switches one recipe to its aarch64 download (or to a source build).
# Recipes not listed here build from source and need no change.
set -euo pipefail
P=${1:-/opt/piston-src}/packages
cd "$P"

# --- binary downloads: x86-64 -> aarch64 --------------------------------------
sed -i 's/linux-x64\.tar/linux-arm64.tar/'                    node/*/build.sh
sed -i 's/linux-x64_bin/linux-aarch64_bin/'                   java/*/build.sh clojure/*/build.sh
sed -i 's/go1\.16\.2\.linux-amd64/go1.16.2.linux-arm64/g'      go/1.16.2/build.sh
sed -i 's/x86_64-unknown-linux-gnu/aarch64-unknown-linux-gnu/g' rust/1.68.2/build.sh rust/1.68.2/compile rust/1.68.2/environment
sed -i 's/OpenJDK8U-jdk_x64_linux_hotspot/OpenJDK8U-jdk_aarch64_linux_hotspot/' kotlin/*/build.sh scala/*/build.sh
sed -i 's/dartsdk-linux-x64-release/dartsdk-linux-arm64-release/' dart/*/build.sh
sed -i 's/fpc-3\.2\.2\.x86_64-linux/fpc-3.2.2.aarch64-linux/'   pascal/3.2.2/build.sh
sed -i 's/powershell-7\.1\.4-linux-x64/powershell-7.1.4-linux-arm64/' pwsh/7.1.4/build.sh
sed -i 's/ghc-9\.0\.1-x86_64-deb10-linux/ghc-9.0.1-aarch64-deb9-linux/' haskell/9.0.1/build.sh
# Maven mirror in the clojure recipe is gone
sed -i 's|https://apache.claz.org/maven/|https://archive.apache.org/dist/maven/|' clojure/*/build.sh

# PowerShell has no ICU in the sandbox image
grep -q GLOBALIZATION_INVARIANT pwsh/7.1.4/environment ||
  echo 'export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1' >> pwsh/7.1.4/environment

# --- gcc: C, C++ and Fortran (D and Objective-C are not built) ----------------
sed -i -E 's/--enable-languages=[a-z+,]+/--enable-languages=c,c++,fortran/' gcc/10.2.0/build.sh

# --- SBCL: no arm64 binary for 2.1.2; build from source, bootstrapped with
#     Debian's sbcl package inside the builder container ------------------------
cat > lisp/2.1.2/build.sh <<'EOF'
#!/usr/bin/env bash
# arm64: build SBCL 2.1.2 from source (host Lisp: Debian buster's sbcl)
PREFIX=$(realpath $(dirname $0))
apt-get update -qq && apt-get install -y -qq sbcl >/dev/null
mkdir -p build
cd build
curl -L "https://downloads.sourceforge.net/project/sbcl/sbcl/2.1.2/sbcl-2.1.2-source.tar.bz2" -o sbcl.tar.bz2
tar xf sbcl.tar.bz2 --strip-components=1
rm sbcl.tar.bz2
sh make.sh --prefix="$PREFIX"
INSTALL_ROOT=$PREFIX sh install.sh
cd ../
rm -rf build
EOF

# Report anything that still points at x86 binaries
left=$(grep -lE 'x86_64|amd64|linux-x64|x64_linux' */*/build.sh || true)
[ -n "$left" ] && { echo "Recipes still downloading x86 binaries (do not build these as-is):"; echo "$left" | sed 's|^|  |'; }
exit 0
