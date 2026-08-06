// A registration body that can actually be published.
//
// The platform refuses to approve a hotline that declares no schemas, no worked
// examples and no limits (FR-010/FR-013). Registration through
// `/controller/register` now carries all of it, so these tests declare a real
// contract rather than registering an empty one and approving it anyway — which
// is how production ended up with a hotline nobody could call correctly.
export function declarableContract(overrides = {}) {
  return {
    input_schema: {
      type: "object",
      required: ["text"],
      additionalProperties: false,
      properties: { text: { type: "string" } }
    },
    output_schema: {
      type: "object",
      required: ["summary"],
      additionalProperties: false,
      properties: { summary: { type: "string" } }
    },
    input_examples: [{ title: "Basic request", input: { text: "a contract to extract terms from" } }],
    output_examples: [{ title: "Basic result", output: { summary: "the extracted terms" } }],
    limitations: ["test hotline: not for production traffic"],
    ...overrides
  };
}
