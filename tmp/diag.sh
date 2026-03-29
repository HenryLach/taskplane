#!/bin/bash

TMPBASE=$(mktemp -d)
echo "Working in: $TMPBASE"

mk() {
    local d="$TMPBASE/$1"
    git init -b main "$d" > /dev/null 2>&1
    git -C "$d" config user.email "t@t.com"
    git -C "$d" config user.name "T"
    git -C "$d" config core.autocrlf false
    mkdir -p "$d/tasks/T1/.reviews"
    cat > "$d/tasks/T1/STATUS.md" << 'EOF'
- [ ] A
- [ ] B
EOF
    echo "prompt" > "$d/tasks/T1/PROMPT.md"
    git -C "$d" add -A && git -C "$d" commit -m init > /dev/null 2>&1
    echo "$d"
}

upd() {
    local d=$1
    cat > "$d/tasks/T1/STATUS.md" << 'EOF'
- [x] A
- [x] B
## Done
EOF
    echo "done" > "$d/tasks/T1/.DONE"
    echo "review" > "$d/tasks/T1/.reviews/R1.md"
}

chk() {
    local d=$1 label=$2
    local cx=$(git -C "$d" show HEAD:tasks/T1/STATUS.md 2>/dev/null | grep -c "\[x\]" || echo 0)
    local dn=0; git -C "$d" show HEAD:tasks/T1/.DONE > /dev/null 2>&1 && dn=1
    local rv=0; git -C "$d" show HEAD:tasks/T1/.reviews/R1.md > /dev/null 2>&1 && rv=1
    echo "  $label: STATUS[x]=$cx .DONE=$dn .reviews=$rv"
}

echo ""
echo "CASE A: FF merge"
D=$(mk a)
git -C "$D" checkout -b orch > /dev/null 2>&1
upd "$D"
git -C "$D" add -A && git -C "$D" commit -m "orch updates" > /dev/null 2>&1
git -C "$D" checkout main > /dev/null 2>&1
git -C "$D" merge --ff-only orch > /dev/null 2>&1
chk "$D" "After FF merge"

echo ""
echo "CASE B: Rebase onto main (unrelated change)"
D=$(mk b)
git -C "$D" checkout -b orch > /dev/null 2>&1
upd "$D"
git -C "$D" add -A && git -C "$D" commit -m "orch updates" > /dev/null 2>&1
git -C "$D" checkout main > /dev/null 2>&1
echo "x" > "$D/other.txt"
git -C "$D" add -A && git -C "$D" commit -m "main change" > /dev/null 2>&1
git -C "$D" checkout orch > /dev/null 2>&1
git -C "$D" rebase main > /dev/null 2>&1
git -C "$D" checkout main > /dev/null 2>&1
git -C "$D" merge --ff-only orch > /dev/null 2>&1
chk "$D" "After rebase(unrelated) + FF"

echo ""
echo "CASE B3: Rebase when main ALSO changed STATUS.md"
D=$(mk b3)
git -C "$D" checkout -b orch > /dev/null 2>&1
upd "$D"
git -C "$D" add -A && git -C "$D" commit -m "orch updates" > /dev/null 2>&1
git -C "$D" checkout main > /dev/null 2>&1
cat > "$D/tasks/T1/STATUS.md" << 'EOF'
- [ ] A
- [ ] B
Extra line on main
EOF
git -C "$D" add -A && git -C "$D" commit -m "main changed STATUS.md" > /dev/null 2>&1
git -C "$D" checkout orch > /dev/null 2>&1
if git -C "$D" rebase main > /dev/null 2>&1; then
    chk "$D" "After rebase(conflicting STATUS.md)"
else
    echo "  REBASE CONFLICT on STATUS.md!"
    git -C "$D" rebase --abort > /dev/null 2>&1
fi

echo ""
echo "CASE C: Squash merge (clean)"
D=$(mk c)
git -C "$D" checkout -b orch > /dev/null 2>&1
echo "code" > "$D/feature.txt"
upd "$D"
git -C "$D" add -A && git -C "$D" commit -m "orch changes" > /dev/null 2>&1
git -C "$D" checkout main > /dev/null 2>&1
echo "x" > "$D/other.txt"
git -C "$D" add -A && git -C "$D" commit -m "main change" > /dev/null 2>&1
git -C "$D" merge --squash orch > /dev/null 2>&1
git -C "$D" commit -m "squash" > /dev/null 2>&1
chk "$D" "After squash merge"

echo ""
echo "CASE C2: Squash after artifact staging OVERWRITES"
D=$(mk c2)
git -C "$D" checkout -b orch > /dev/null 2>&1
echo "code" > "$D/feature.txt"
upd "$D"
git -C "$D" add -A && git -C "$D" commit -m "lane merge: correct STATUS" > /dev/null 2>&1
# Simulate artifact staging: overwrite with OLD content
cat > "$D/tasks/T1/STATUS.md" << 'EOF'
- [ ] A
- [ ] B
EOF
rm -f "$D/tasks/T1/.DONE" "$D/tasks/T1/.reviews/R1.md"
git -C "$D" add -A && git -C "$D" commit -m "checkpoint artifacts" > /dev/null 2>&1
echo "  Orch tip after artifact overwrite:"
chk "$D" "Orch tip"
git -C "$D" checkout main > /dev/null 2>&1
echo "x" > "$D/other.txt"
git -C "$D" add -A && git -C "$D" commit -m "main change" > /dev/null 2>&1
git -C "$D" merge --squash orch > /dev/null 2>&1
git -C "$D" commit -m "squash" > /dev/null 2>&1
chk "$D" "After squash (artifact overwrite)"

echo ""
echo "CASE D: Artifact staging isolation"
D=$(mk d)
ORIG=$(cat "$D/tasks/T1/STATUS.md")
git -C "$D" checkout -b orch > /dev/null 2>&1
upd "$D"
git -C "$D" add -A && git -C "$D" commit -m "lane merge" > /dev/null 2>&1
echo "$ORIG" > "$D/tasks/T1/STATUS.md"
git -C "$D" add -A
if git -C "$D" diff --cached --quiet; then
    echo "  Artifact staging: NO-OP (same content)"
else
    echo "  Artifact staging: CHANGES STATUS.md! ROOT CAUSE CONFIRMED"
    git -C "$D" diff --cached --stat
fi

echo ""
echo "DONE"
rm -rf "$TMPBASE"
