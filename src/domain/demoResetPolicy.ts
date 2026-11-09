import { z } from "zod";
export const RESET_CONFIRMATION = "RESET SAMPLE DATA";
export const ResetInput = z.object({ confirmation: z.literal(RESET_CONFIRMATION) }).strict();
export function resetPolicy(env: Record<string, string | undefined>): boolean {
    const url = env.DATABASE_URL;
    return env.NODE_ENV !== "production" && env.DEMO_MODE === "true" && env.M8_DEMO_RESET_ENABLED === "true" && !!url && url === env.M8_DEMO_RESET_DATABASE_URL && /^file:\.\/(?:m8-demo-[a-zA-Z0-9_-]+|m7-demo-m8-[a-zA-Z0-9_-]+)\.db$/.test(url);
}
