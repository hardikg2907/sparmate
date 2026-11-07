export default {
  extends: ["@commitlint/config-conventional"],
  // Dependabot titles can run past the header limit and are not written by hand.
  ignores: [(message) => /^(build|ci)(\(deps(-dev)?\))?: bump /.test(message)],
  rules: {
    // Existing history uses unwrapped body paragraphs.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
    "header-max-length": [2, "always", 72],
    "type-enum": [2, "always", ["feat", "fix", "docs", "style", "refactor", "test", "build", "ci", "chore"]],
  },
};
