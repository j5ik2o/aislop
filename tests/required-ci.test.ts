import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const workflowUrl = new URL("../.github/workflows/required-ci.yml", import.meta.url);
const workflow = YAML.parse(readFileSync(workflowUrl, "utf-8")) as {
	jobs: { required: { steps: Array<{ run: string }> } };
};
const [gate] = workflow.jobs.required.steps;

const passingResults = {
	CHECKOUT_RESULT: "success",
	CHECKOUT_SHA: "a".repeat(40),
	CI_RESULT: "success",
	CI_PASSED: "true",
	AISLOP_RESULT: "success",
	AISLOP_PASSED: "true",
};

function runGate(results: Record<string, string | undefined>) {
	const env = { ...process.env };
	for (const [name, value] of Object.entries(results)) {
		if (value === undefined) {
			delete env[name];
		} else {
			env[name] = value;
		}
	}
	const result = spawnSync(process.execPath, ["--eval", gate.run], { env, encoding: "utf-8" });
	expect(result.error).toBeUndefined();
	expect(result.stderr).toBe("");
	return result.status;
}

describe("Required CI (main)", () => {
	it("starts checkout verification from the event commit before resolving a moving merge ref", () => {
		const checkoutUrl = new URL("../.github/workflows/ci-checkout.yml", import.meta.url);
		const checkoutWorkflow = YAML.parse(readFileSync(checkoutUrl, "utf-8")) as {
			jobs: { resolve: { steps: Array<{ with?: { ref?: string } }> } };
		};
		expect(checkoutWorkflow.jobs.resolve.steps[0]?.with?.ref).toBe("${{ github.sha }}");
	});

	it("passes when both workflows completed every required job", () => {
		expect(runGate(passingResults)).toBe(0);
	});

	it.each(["failure", "cancelled", "skipped", "neutral", "unknown", "", undefined])(
		"blocks either workflow with result %s",
		(result) => {
			expect(runGate({ ...passingResults, CHECKOUT_RESULT: result })).toBe(1);
			expect(runGate({ ...passingResults, CI_RESULT: result })).toBe(1);
			expect(runGate({ ...passingResults, AISLOP_RESULT: result })).toBe(1);
		},
	);

	it.each(["", "unknown", undefined])("blocks an invalid checkout SHA %s", (sha) => {
		expect(runGate({ ...passingResults, CHECKOUT_SHA: sha })).toBe(1);
	});

	it.each(["false", "unknown", "", undefined])(
		"blocks either workflow with completion output %s even on success",
		(passed) => {
			expect(runGate({ ...passingResults, CI_PASSED: passed })).toBe(1);
			expect(runGate({ ...passingResults, AISLOP_PASSED: passed })).toBe(1);
		},
	);
});
