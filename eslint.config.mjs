import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["**/lib/**", "**/dist/**", "**/node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: [
      "apps/web/src/**/*.{ts,tsx}",
      "functions/src/**/*.ts",
      "packages/shared/src/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
