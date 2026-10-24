import { defineConfig } from 'oxfmt';

export default defineConfig({
  endOfLine: 'lf',
  ignorePatterns: ['node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**'],
  printWidth: 120,
  proseWrap: 'preserve',
  semi: true,
  singleQuote: true,
  sortImports: {
    newlinesBetween: false,
  },
  sortPackageJson: false,
  tabWidth: 2,
  trailingComma: 'all',
  useTabs: false,
});
