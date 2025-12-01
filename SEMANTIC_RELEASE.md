# Semantic Release Guide

This project uses [semantic-release](https://semantic-release.gitbook.io/) for automated versioning and package publishing.

## How It Works

Semantic-release automatically:
- Determines the next version number based on commit messages
- Generates release notes
- Creates a Git tag
- Publishes to npm
- Updates the CHANGELOG.md

## Commit Message Format

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

| Type | Description | Version Bump |
|------|-------------|--------------|
| `feat` | A new feature | Minor (0.x.0) |
| `fix` | A bug fix | Patch (0.0.x) |
| `perf` | Performance improvement | Patch (0.0.x) |
| `docs` | Documentation changes | Patch (0.0.x) |
| `refactor` | Code refactoring | Patch (0.0.x) |
| `style` | Code style changes | No release |
| `test` | Test changes | No release |
| `build` | Build system changes | No release |
| `ci` | CI configuration changes | No release |
| `chore` | Other changes | No release |
| `revert` | Revert a previous commit | Patch (0.0.x) |

### Breaking Changes

To trigger a **major version** bump (x.0.0), include `BREAKING CHANGE:` in the footer or add `!` after the type:

```
feat!: remove deprecated API

BREAKING CHANGE: The old API has been removed. Use the new API instead.
```

### Examples

#### New Feature (Minor Release)
```
feat(renderer): add support for custom timeout in invoke methods

Add InvokeOptions parameter to all invoke methods allowing per-call
timeout configuration while maintaining backward compatibility.
```

#### Bug Fix (Patch Release)
```
fix(throttled): prevent memory leak in message coalescing

Clear the coalescing map after flushing to prevent unbounded growth
in long-running applications.
```

#### Documentation (Patch Release)
```
docs: update README with E2E testing examples

Add comprehensive examples showing how to write Playwright E2E tests
for DirectIPC functionality.
```

#### Breaking Change (Major Release)
```
feat!: change throttled API to property accessor

BREAKING CHANGE: DirectIpcThrottled is now accessed via `directIpc.throttled`
instead of being instantiated separately. This simplifies the API and ensures
consistent configuration between throttled and non-throttled instances.

Migration:
- Before: `const throttled = new DirectIpcThrottled(directIpc)`
- After: `const throttled = directIpc.throttled`
```

## Release Process

### Automatic Releases (Recommended)

Releases happen automatically when commits are merged to `main`:

1. **Create a feature branch:**
   ```bash
   git checkout -b feat/my-new-feature
   ```

2. **Make your changes and commit with conventional format:**
   ```bash
   git add .
   git commit -m "feat(renderer): add new feature"
   ```

   Note: Commitlint will validate your commit message format.

3. **Push and create a pull request:**
   ```bash
   git push origin feat/my-new-feature
   ```

4. **After PR is merged to `main`:**
   - GitHub Actions runs the release workflow
   - Semantic-release analyzes commits since last release
   - If releasable changes exist:
     - Determines version number
     - Updates package.json
     - Generates CHANGELOG.md
     - Creates Git tag
     - Publishes to npm
     - Creates GitHub release

### Manual Release (Testing)

For testing the release process locally:

```bash
# Dry run (no actual release)
npm run semantic-release -- --dry-run

# See what would be released
npm run semantic-release -- --dry-run --no-ci
```

## CI/CD Setup

### Required GitHub Secrets

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

1. **`GITHUB_TOKEN`** - Automatically provided by GitHub Actions (no setup needed)
2. **`NPM_TOKEN`** - Your npm publishing token
   - Create at: https://www.npmjs.com/settings/YOUR_USERNAME/tokens
   - Type: "Automation" token
   - Scope: "Read and write"

### Workflows

#### `.github/workflows/release.yml`
Runs on every push to `main` to create releases.

#### `.github/workflows/ci.yml`
Runs on pull requests to validate:
- Linting
- Type checking
- Unit tests
- E2E tests

## Configuration Files

### `.releaserc.json`
Configures semantic-release plugins and behavior:
- Commit analysis rules
- Release note generation
- Changelog updates
- npm publishing
- Git tag creation

### `.commitlintrc.json`
Configures commit message validation rules:
- Allowed types
- Message format requirements
- Character limits

### `.husky/commit-msg`
Git hook that validates commit messages before they're created.

## Version Strategy

This project follows [Semantic Versioning](https://semver.org/):

- **Major (x.0.0)**: Breaking changes
- **Minor (0.x.0)**: New features (backward compatible)
- **Patch (0.0.x)**: Bug fixes and improvements

## Troubleshooting

### Commit message validation fails

If your commit is rejected:
```
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]
```

Ensure your message follows the format: `type: description`

### Release didn't trigger

Check:
1. Commits since last release include releasable changes (feat, fix, etc.)
2. Commits follow conventional format
3. GitHub Actions workflow completed successfully
4. No [skip ci] or [skip release] in commit messages

### NPM publish failed

Verify:
1. `NPM_TOKEN` secret is set correctly in GitHub
2. Token has "Automation" type and "Read and write" scope
3. You have publish permissions for the package
4. Package name is not already taken (for first release)

## Best Practices

1. **Write clear commit messages** - They become your changelog
2. **One commit per logical change** - Makes history easier to follow
3. **Use conventional format** - Enables automated versioning
4. **Include breaking change notices** - Helps users upgrade safely
5. **Reference issues** - Add `Fixes #123` to link commits to issues

## Resources

- [Conventional Commits Spec](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
- [Semantic Release Docs](https://semantic-release.gitbook.io/)
- [Commitlint Docs](https://commitlint.js.org/)
