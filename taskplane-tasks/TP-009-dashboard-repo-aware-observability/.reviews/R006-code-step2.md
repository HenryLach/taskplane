# R006 Code Review — TP-009 Step 2 (Preserve existing UX guarantees)

## Verdict: **REVISE**

Step 2 updates STATUS/evidence, but one UX guarantee is still not met in the implementation.

## What I reviewed
- Diff range: `e73613a..HEAD`
- Changed files:
  - `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md`
  - `taskplane-tasks/TP-009-dashboard-repo-aware-observability/.reviews/R004-code-step1.md`
  - `taskplane-tasks/TP-009-dashboard-repo-aware-observability/.reviews/R005-plan-step2.md`
  - `taskplane-tasks/TP-009-dashboard-repo-aware-observability/.reviews/request-R004.md`
  - `taskplane-tasks/TP-009-dashboard-repo-aware-observability/.reviews/request-R005.md`
- Neighbor checks:
  - `dashboard/public/app.js`
  - `dashboard/public/index.html`
  - `dashboard/public/style.css`
  - `dashboard/server.cjs`
- Validation run:
  - `cd extensions && npx vitest run` ✅ (290/290)

---

## Findings

### 1) Repo filter reset guarantee is still violated on hide → show transition
**Severity:** Medium  
**Files:**
- `dashboard/public/app.js:187-220`
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md:88-95`

`STATUS.md` claims `updateRepoFilter([])` “resets selection to All”, but `updateRepoFilter()` only resets `selectedRepo` (state var) and does **not** sync `$repoFilter.value` on the hide path. If repos later return with the same option set, `changed === false` and the `<select>` value is never corrected.

So the UI can display repo `B` while logic is actually filtering as “All repos” (`selectedRepo === ""`).

Deterministic reproduction (logic-equivalent script):
```bash
node - <<'NODE'
let selectedRepo='';
let knownRepos=[];
let repoFilterVisible=false;
const $repoFilter={style:{display:'none'},options:[{value:''}],value:'',appendChild(opt){this.options.push(opt);}};
function mkOpt(v){return {value:v};}
function updateRepoFilter(repos){
  knownRepos=repos;
  const shouldShow=repos.length>=2;
  if(shouldShow!==repoFilterVisible){$repoFilter.style.display=shouldShow?'':'none';repoFilterVisible=shouldShow;}
  if(!shouldShow){selectedRepo='';return;}
  if(selectedRepo && !repos.includes(selectedRepo)) selectedRepo='';
  const currentOpts=Array.from($repoFilter.options).slice(1).map(o=>o.value);
  const changed=currentOpts.length!==repos.length || currentOpts.some((v,i)=>v!==repos[i]);
  if(changed){
    const prev=selectedRepo;
    $repoFilter.options=[{value:''}];
    for(const r of repos){$repoFilter.appendChild(mkOpt(r));}
    $repoFilter.value=prev;
  }
}
updateRepoFilter(['A','B']);
selectedRepo='B'; $repoFilter.value='B';
updateRepoFilter([]);
updateRepoFilter(['A','B']);
console.log({selectedRepo, uiValue:$repoFilter.value});
NODE
```
Output:
```text
{ selectedRepo: '', uiValue: 'B' }
```

**Suggested fix:**
- In hide path: set `$repoFilter.value = ""`.
- In show path: always synchronize `$repoFilter.value = selectedRepo` after reconciliation, not only when options changed.

---

### 2) STATUS review ledger contains duplicate rows and malformed trailing separator
**Severity:** Low  
**File:** `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md:131-143`

`R004` and `R005` entries are duplicated, and the markdown separator row appears at the end of the table. This hurts audit clarity for operator/reviewer history.

---

## Summary
Step 2 should be revised before approval: fix the repo-filter state/UI synchronization bug, then update STATUS evidence to reflect the corrected behavior.
