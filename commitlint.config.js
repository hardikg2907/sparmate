export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Existing history uses unwrapped body paragraphs.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
    "header-max-length": [2, "always", 72],
    "type-enum": [2, "always", ["feat", "fix", "docs", "style", "refactor", "test", "build", "ci", "chore"]],
  },
};
