#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Regenerate the user-manual PDFs from the HTML guides.
#
# WHY: the committed PDFs go stale whenever a user-guide-*.html is edited, and a
# PDF generated before the print-CSS fix splits tall screenshots across pages.
# The HTML print CSS now caps images (`max-height:90vh`) + `page-break-inside:
# avoid; break-inside:avoid`, so a fresh render keeps every screenshot whole.
#
# Renders with the Playwright-cached chromium via --print-to-pdf (respects the
# @media print CSS). Output filenames are unchanged → existing links keep working.
#
# ── ONE-TIME prereq (needs sudo — chromium shared libs missing on this host) ──
#   sudo apt-get install -y libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
#     libatk-bridge2.0-0 libatk1.0-0 libcups2 libxkbcommon0 libxrandr2 libgbm1 \
#     libxshmfence1 libxss1 libasound2t64 libnss3 libxcomposite1 libxdamage1 libxfixes3
#   (Without these the chromium binary fails: "libcairo.so.2: cannot open ...")
#
# Run:  bash scripts/build-manual-pdf.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MANUAL="/home/schoolbus/apps/lampang-bus-system/docs/manual-html"
PDF_DIR="$MANUAL/pdf"
CHROME="$(find "$HOME/.cache/ms-playwright" -maxdepth 3 -type f -name chrome 2>/dev/null | sort | tail -1)"

[ -n "$CHROME" ] && [ -x "$CHROME" ] || { echo "ERROR: chromium not found under ~/.cache/ms-playwright"; exit 1; }
[ -d "$MANUAL" ] || { echo "ERROR: manual dir not found: $MANUAL"; exit 1; }

# This host lacks chromium's libcairo/libpango. Rather than a root apt-get, the
# closure was extracted (no sudo) to ~/.cache/manual-pdf-libs via:
#   apt-get download libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libpangoft2-1.0-0 \
#     libpixman-1-0 libharfbuzz0b libthai0 libdatrie1 libfribidi0 libgraphite2-3 \
#     libxcb-render0 libxcb-shm0
#   for d in *.deb; do dpkg-deb -x "$d" ~/.cache/manual-pdf-libs/root; done
# Prepend it if present (harmless on a host that already has the system libs).
EXTRA_LIBS="$HOME/.cache/manual-pdf-libs/root/usr/lib/x86_64-linux-gnu"
[ -d "$EXTRA_LIBS" ] && export LD_LIBRARY_PATH="$EXTRA_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# role -> Thai distribution filename (same content, the name people were given)
declare -A TH=(
  [driver]="คู่มือ-คนขับ" [school]="คู่มือ-โรงเรียน" [transport]="คู่มือ-ขนส่ง"
  [affiliation]="คู่มือ-สังกัดเขต" [province]="คู่มือ-จังหวัด"
  [admin]="คู่มือ-ผู้ดูแลระบบ" [parent]="คู่มือ-ผู้ปกครอง"
)

render() { # <html-basename> <out.pdf>
  "$CHROME" --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer \
    --print-to-pdf="$PDF_DIR/$2" "file://$MANUAL/$1" >/dev/null 2>&1
}

cd "$MANUAL"
# The english-named PDFs (driver.pdf …) are SYMLINKS to the Thai distribution
# files (คู่มือ-คนขับ.pdf …) — render straight to the real Thai file; the symlink
# (and the HTML href="pdf/driver.pdf") then points at the fresh content.
for r in driver school transport affiliation province admin parent; do
  echo "==> ${TH[$r]}.pdf  (= $r.pdf)"
  render "user-guide-$r.html" "${TH[$r]}.pdf"
done
echo "==> คู่มือ-สารบัญหลัก.pdf  (index)"
render "index.html" "คู่มือ-สารบัญหลัก.pdf"

echo "done — PDFs regenerated in $PDF_DIR (same filenames = same links)."
echo "Next: commit the updated PDFs; the web serves them in-place via the dist/manual symlink (no rebuild needed)."
