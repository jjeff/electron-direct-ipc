# Dual Build Setup (ESM + CommonJS)

This library uses a dual build system to support both ESM and CommonJS consumers.

## Why Dual Build?

Electron preload scripts **must** use CommonJS because they run in a special context that doesn't support ESM. However, modern applications often prefer ESM. This dual build allows the library to work in both contexts.

## Build Structure

```
dist/
├── esm/              # ES Module build
│   ├── package.json  # {"type": "module"}
│   ├── main/
│   ├── renderer/
│   └── common/
└── cjs/              # CommonJS build
    ├── package.json  # {"type": "commonjs"}
    ├── main/
    ├── renderer/
    └── common/
```

## How It Works

1. **Root package.json** has `"type": "module"` to make the library ESM by default
2. **dist/esm/package.json** explicitly marks ESM files as modules
3. **dist/cjs/package.json** explicitly marks CJS files as CommonJS (overriding parent)
4. **package.json exports** field provides conditional resolution:
   - `import` statements → ESM build
   - `require()` calls → CJS build

## Build Scripts

- `npm run build` - Builds both ESM and CJS, then creates package.json files
- `npm run build:esm` - TypeScript compilation with ESM output
- `npm run build:cjs` - TypeScript compilation with CommonJS output
- `npm run build:pkg` - Creates the package.json files in dist/

## Usage

### In Preload Scripts (CommonJS)
```typescript
import { DirectIpcRenderer } from 'electron-direct-ipc/renderer';
// Resolves to dist/cjs/renderer/DirectIpcRenderer.js
```

### In Modern Apps (ESM)
```typescript
import { DirectIpcRenderer } from 'electron-direct-ipc/renderer';
// Resolves to dist/esm/renderer/DirectIpcRenderer.js
```

## Important Notes

- The package.json files in `dist/` are **auto-generated** during build
- Never commit these files - they're in .gitignore
- Source files must use `.js` extensions in imports for ESM compatibility
- The test-app uses CommonJS to test the CJS build in a real Electron context
