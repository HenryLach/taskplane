// Mock for @mariozechner/pi-ai — provides Type (TypeBox) for tool parameter schemas
export type Model = any;
export type Api = any;
export const Type = {
	Object: (props: any) => ({ type: "object", properties: props }),
	String: (opts?: any) => ({ type: "string", ...opts }),
	Boolean: (opts?: any) => ({ type: "boolean", ...opts }),
	Number: (opts?: any) => ({ type: "number", ...opts }),
	Optional: (schema: any) => ({ ...schema, optional: true }),
	Union: (schemas: any[]) => ({ anyOf: schemas }),
	Literal: (value: any) => ({ const: value }),
	Array: (schema: any) => ({ type: "array", items: schema }),
};
