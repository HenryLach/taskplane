import fs from "fs";
const f = "extensions/taskplane/hold-state.ts"; let s = fs.readFileSync(f, "utf8");
const rep = (a, b) => { if (s.split(a).length !== 2) { console.error("ANCHOR", a.slice(0, 80), s.split(a).length); process.exit(1); } s = s.replace(a, b); };
rep(`	if (open.length > 0) {
		if (existing.status === "held") return noop;
		existing.status = "held";
		existing.exitReason = \`Held — awaiting ruling on \${open.map((h) => h.escalationId).join(", ")}\`;
		existing.endTime = null;
		return { changed: true, restore };
	}
	if (releasedUnacked.length > 0) {
		if (existing.status === "running" && !/^Held|^Hold timeout/.test(existing.exitReason)) return noop;
		existing.status = "running";
		existing.exitReason = \`Ruling \${releasedUnacked.map((h) => h.ruling?.id ?? "?").join(", ")} accepted — worker relaunched\`;
		existing.endTime = null;
		return { changed: true, restore };
	}
	return noop;`,
`	let want: { status: LaneTaskOutcome["status"]; exitReason: string } | null = null;
	if (open.length > 0) {
		want = {
			status: "held",
			exitReason: \`Held — awaiting ruling on \${open.map((h) => h.escalationId).join(", ")}\`,
		};
	} else if (releasedUnacked.length > 0) {
		want = {
			status: "running",
			exitReason: \`Ruling \${releasedUnacked.map((h) => h.ruling?.id ?? "?").join(", ")} accepted — worker relaunched\`,
		};
	}
	if (!want) return noop;
	if (existing.status === want.status && existing.exitReason === want.exitReason) return noop;
	existing.status = want.status;
	existing.exitReason = want.exitReason;
	existing.endTime = null;
	return { changed: true, restore };`);
fs.writeFileSync(f, s); console.log("ok");
