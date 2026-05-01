import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type Params = Record<string, string | number>;
type Translate = (key: string, fallback: string, params?: Params) => string;

let translate: Translate = (_key, fallback, params) => format(fallback, params);

function format(text: string, params?: Params): string {
	if (!params) return text;
	return text.replace(/\{(\w+)\}/g, (_match, key: string) => String(params[key] ?? `{${key}}`));
}

export function t(key: string, fallback: string, params?: Params): string {
	return translate(key, fallback, params);
}

const bundles = [
	{
		locale: "ja",
		namespace: "taskplane",
		messages: {
			"cmd.orch.description": "バッチ実行またはスーパーバイザーを開始: /orch [<areas|paths|all>]",
			"cmd.orchPlan.description": "実行計画をプレビュー: /orch-plan <areas|paths|all> [--refresh]",
			"cmd.orchStatus.description": "現在のバッチ進捗を表示",
			"cmd.orchPause.description": "現在のタスク完了後にバッチを一時停止",
			"cmd.orchResume.description": "一時停止または中断したバッチを再開: /orch-resume [--force]",
			"cmd.orchAbort.description": "バッチを中止: /orch-abort [--hard]",
			"cmd.orchDeps.description": "依存関係グラフを表示: /orch-deps <areas|paths|all> [--refresh] [--task <id>]",
			"cmd.orchSessions.description": "アクティブなオーケストレーターセッションを一覧表示",
			"cmd.orchTakeover.description": "別セッションのスーパーバイザーを強制的に引き継ぐ: /orch-takeover",
			"cmd.orchIntegrate.description": "完了した orch バッチを作業ブランチへ統合",
			"cmd.settings.description": "taskplane 設定を表示・編集",
		},
	},
	{
		locale: "zh-CN",
		namespace: "taskplane",
		messages: {
			"cmd.orch.description": "启动批量执行或监督器: /orch [<areas|paths|all>]",
			"cmd.orchPlan.description": "预览执行计划: /orch-plan <areas|paths|all> [--refresh]",
			"cmd.orchStatus.description": "显示当前批次进度",
			"cmd.orchPause.description": "当前任务完成后暂停批次",
			"cmd.orchResume.description": "恢复已暂停或中断的批次: /orch-resume [--force]",
			"cmd.orchAbort.description": "中止批次: /orch-abort [--hard]",
			"cmd.orchDeps.description": "显示依赖图: /orch-deps <areas|paths|all> [--refresh] [--task <id>]",
			"cmd.orchSessions.description": "列出活动的编排器会话",
			"cmd.orchTakeover.description": "从另一个会话强制接管监督器: /orch-takeover",
			"cmd.orchIntegrate.description": "将完成的 orch 批次集成到工作分支",
			"cmd.settings.description": "查看和编辑 taskplane 配置",
		},
	},
	{
		locale: "de",
		namespace: "taskplane",
		messages: {
			"cmd.orch.description": "Batch-Ausführung oder Supervisor starten: /orch [<areas|paths|all>]",
			"cmd.orchPlan.description": "Ausführungsplan anzeigen: /orch-plan <areas|paths|all> [--refresh]",
			"cmd.orchStatus.description": "Aktuellen Batch-Fortschritt anzeigen",
			"cmd.orchPause.description": "Batch nach Abschluss der aktuellen Tasks pausieren",
			"cmd.orchResume.description": "Pausierten oder unterbrochenen Batch fortsetzen: /orch-resume [--force]",
			"cmd.orchAbort.description": "Batch abbrechen: /orch-abort [--hard]",
			"cmd.orchDeps.description": "Abhängigkeitsgraph anzeigen: /orch-deps <areas|paths|all> [--refresh] [--task <id>]",
			"cmd.orchSessions.description": "Aktive Orchestrator-Sitzungen auflisten",
			"cmd.orchTakeover.description": "Supervisor aus einer anderen Sitzung erzwingen übernehmen: /orch-takeover",
			"cmd.orchIntegrate.description": "Abgeschlossenen orch-Batch in den Arbeitsbranch integrieren",
			"cmd.settings.description": "taskplane-Konfiguration anzeigen und bearbeiten",
		},
	},
];

export function initI18n(pi: ExtensionAPI): void {
	const events = pi.events;
	if (!events) return;
	for (const bundle of bundles) events.emit("pi-core/i18n/registerBundle", bundle);
	events.emit("pi-core/i18n/requestApi", {
		namespace: "taskplane",
		callback(api: { t?: Translate } | undefined) {
			if (typeof api?.t === "function") translate = api.t;
		},
	});
}
