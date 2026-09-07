import { readFileSync, writeFileSync } from "node:fs";
function patch(f, pairs) { let s = readFileSync(f, "utf8"); for (const [a, b] of pairs) { const n = s.split(a).length - 1; if (n !== 1) { console.error("anchor", n, "in", f, ":", a.slice(0, 90)); process.exit(1); } s = s.replace(a, b); } writeFileSync(f, s); console.log("patched", f); }
patch("extensions/taskplane/resume.ts", [[
`	const mergedWaves = new Set<number>();
	for (const mr of persistedState.mergeResults ?? []) {
		if (mr.status === "succeeded") mergedWaves.add(mr.waveIndex);
	}
	const waveOfTask = new Map<string, number>();
	wavePlan.forEach((wave, i) => {
		for (const id of wave) waveOfTask.set(id, i);
	});
	const succeededById = new Map(persistedState.tasks.map((t) => [t.taskId, t.status === "succeeded"]));
	return persistedState.lanes.filter((laneRecord) => {
		if (laneRecord.taskIds.length === 0) return false;
		if (!laneRecord.taskIds.every((id) => succeededById.get(id))) return false;
		if (laneRecord.taskIds.some((id) => reExecutedTaskIds.has(id))) return false;
		const waves = laneRecord.taskIds.map((id) => waveOfTask.get(id));
		if (waves.some((w) => w === undefined || mergedWaves.has(w))) return false;
		return true;
	});`,
`	// LATEST merge status per wave (same rule computeResumePoint uses) — an older
	// succeeded record must not mask a later failure (success → failure while a
	// third task is still pending left succeeded work permanently unmerged).
	const waveMerged = (w: number) =>
		getMergeStatusForWave(persistedState.mergeResults ?? [], w) === "succeeded";
	const waveOfTask = new Map<string, number>();
	wavePlan.forEach((wave, i) => {
		for (const id of wave) waveOfTask.set(id, i);
	});
	const succeededById = new Map(persistedState.tasks.map((t) => [t.taskId, t.status === "succeeded"]));
	return persistedState.lanes.filter((laneRecord) => {
		if (laneRecord.taskIds.length === 0) return false;
		if (!laneRecord.taskIds.every((id) => succeededById.get(id))) return false;
		if (laneRecord.taskIds.some((id) => reExecutedTaskIds.has(id))) return false;
		const waves = laneRecord.taskIds.map((id) => waveOfTask.get(id));
		if (waves.some((w) => w === undefined || waveMerged(w))) return false;
		return true;
	});`]]);
