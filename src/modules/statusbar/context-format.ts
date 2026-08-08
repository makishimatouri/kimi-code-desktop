// 与原生 CLI footer 的 context 读数保持一致：
// - 百分比优先用精确 token 数计算（ceil、clamp 到 [0,100]、非零至少 1%）
// - token 数为 1024 进制紧凑格式（85.3k / 977k / 256k / 1.5M）
import { formatTokenCount } from "@/lib/managed-usage";

export { formatTokenCount };

function hasExactWindow(
	contextTokens?: number | null,
	maxContextTokens?: number | null,
): contextTokens is number {
	return (
		typeof contextTokens === "number" &&
		Number.isFinite(contextTokens) &&
		typeof maxContextTokens === "number" &&
		maxContextTokens > 0
	);
}

export function contextPercent(
	usage: number,
	contextTokens?: number | null,
	maxContextTokens?: number | null,
): number {
	const ratio = hasExactWindow(contextTokens, maxContextTokens)
		? contextTokens / (maxContextTokens as number)
		: Number.isFinite(usage)
			? usage
			: 0;
	if (ratio <= 0) return 0;
	// ceil 天然保证非零用量至少显示 1%
	return Math.min(100, Math.ceil(ratio * 100));
}

export function formatContextStatus(
	usage: number,
	contextTokens?: number | null,
	maxContextTokens?: number | null,
): string {
	const pct = contextPercent(usage, contextTokens, maxContextTokens);
	if (hasExactWindow(contextTokens, maxContextTokens)) {
		return `context: ${pct}% (${formatTokenCount(contextTokens)}/${formatTokenCount(maxContextTokens as number)})`;
	}
	return `context: ${pct}%`;
}
