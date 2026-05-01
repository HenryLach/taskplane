type Locale = "en" | "es" | "fr" | "pt-BR";
type Params = Record<string, string | number>;

const translations: Record<Exclude<Locale, "en">, Record<string, string>> = {
	es: {
		"orch.resume.usage": "Uso: /orch-resume [--force]\n\n  --force   Reanuda desde estado detenido o fallido (ejecuta primero diagnósticos previos)",
		"orch.resume.unknownFlag": "Flag desconocido: {flag}\n\nUso: /orch-resume [--force]",
		"orch.resume.unexpectedArg": "Argumento inesperado: {arg}\n\nUso: /orch-resume [--force]",
	},
	fr: {
		"orch.resume.usage": "Utilisation : /orch-resume [--force]\n\n  --force   Reprendre depuis un état arrêté ou en échec (exécute d’abord les diagnostics préalables)",
		"orch.resume.unknownFlag": "Option inconnue : {flag}\n\nUtilisation : /orch-resume [--force]",
		"orch.resume.unexpectedArg": "Argument inattendu : {arg}\n\nUtilisation : /orch-resume [--force]",
	},
	"pt-BR": {
		"orch.resume.usage": "Uso: /orch-resume [--force]\n\n  --force   Retoma de um estado parado ou com falha (executa diagnósticos prévios primeiro)",
		"orch.resume.unknownFlag": "Flag desconhecida: {flag}\n\nUso: /orch-resume [--force]",
		"orch.resume.unexpectedArg": "Argumento inesperado: {arg}\n\nUso: /orch-resume [--force]",
	},
};

let currentLocale: Locale = "en";

export function initI18n(pi: { events?: { emit?: (event: string, payload: unknown) => void } }): void {
	pi.events?.emit?.("pi-core/i18n/registerBundle", {
		namespace: "taskplane",
		defaultLocale: "en",
		locales: translations,
	});
	pi.events?.emit?.("pi-core/i18n/requestApi", {
		onReady: (api: { getLocale?: () => string; onLocaleChange?: (cb: (locale: string) => void) => void }) => {
			const locale = api.getLocale?.();
			if (isLocale(locale)) currentLocale = locale;
			api.onLocaleChange?.((next) => {
				if (isLocale(next)) currentLocale = next;
			});
		},
	});
}

export function t(key: string, fallback: string, params: Params = {}): string {
	const template = currentLocale === "en" ? fallback : translations[currentLocale]?.[key] ?? fallback;
	return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

function isLocale(locale: string | undefined): locale is Locale {
	return locale === "en" || locale === "es" || locale === "fr" || locale === "pt-BR";
}
