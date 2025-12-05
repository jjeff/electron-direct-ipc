# Development Container for Electron Direct IPC

This devcontainer configuration provides a fully isolated development environment for the Electron Direct IPC project with Claude Code integration.

## Features

- **Node.js 24**: Matches the project's engine requirements
- **Claude Code CLI**: Pre-installed and ready to use with `--dangerously-skip-permissions` mode
- **Electron Dependencies**: All required system libraries for Electron development and testing
- **Isolated node_modules**: Container's npm installations won't affect the host machine
- **Security**: Firewall configuration restricts network access to essential services only
- **Development Tools**: git-delta, zsh with powerline10k, fzf, and more

## Getting Started

### Prerequisites

- [VS Code](https://code.visualstudio.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### Opening the Project

1. Open VS Code
2. Open this project folder
3. When prompted, click "Reopen in Container" or run `Dev Containers: Reopen in Container` from the command palette (Cmd/Ctrl+Shift+P)
4. Wait for the container to build (first time only)

## Using Claude Code

Once inside the container, you can use Claude Code in two ways:

### 1. VS Code Extension

The Claude Code extension is pre-installed and configured. Use it directly from VS Code.

### 2. Command Line

Open a terminal in VS Code (inside the container) and run:

```bash
# Run Claude Code with dangerously-skip-permissions mode
claude --dangerously-skip-permissions

# Or just use Claude Code normally
claude
```

The `--dangerously-skip-permissions` flag allows Claude Code to run without prompting for permission on each file operation, which is safe inside the isolated container environment.

## Development Workflow

### Installing Dependencies

Inside the container, run:

```bash
npm install
```

The `node_modules` directory is stored in a Docker volume, so it won't affect your host machine's file system. You can still develop on the host without conflicts.

### Building the Project

```bash
npm run build
```

### Running Tests

```bash
# Unit tests
npm test

# E2E tests (with Playwright)
npm run test:e2e
```

### Linting and Formatting

```bash
npm run lint
npm run format
```

## Key Configuration Details

### Volume Mounts

The devcontainer uses Docker volumes to isolate:

- `/workspace/node_modules` - Main project dependencies
- `/workspace/test-app/node_modules` - Test app dependencies
- `/home/node/.claude` - Claude Code configuration
- `/commandhistory` - Shell history persistence

This means you can:
- Install dependencies inside the container without affecting the host
- Work on the same codebase from both inside and outside the container
- Each environment maintains its own binary builds (important for Electron!)

### Network Security

The included firewall (`init-firewall.sh`) restricts outbound connections to:
- npm registry
- GitHub
- Anthropic APIs
- Essential development services

This provides additional security when running AI-assisted coding tools.

### Environment Variables

- `ELECTRON_DISABLE_SANDBOX=1` - Required for running Electron in containers
- `NODE_OPTIONS=--max-old-space-size=4096` - Increased memory for large builds
- `DEVCONTAINER=true` - Indicates running in a dev container

## Troubleshooting

### Container won't start

1. Ensure Docker Desktop is running
2. Try rebuilding: `Dev Containers: Rebuild Container`

### npm install fails

1. Check your network connection
2. Verify firewall isn't blocking npm registry
3. Try: `npm install --verbose` for detailed logs

### Electron tests fail

The container includes all Electron dependencies, but if tests fail:

1. Ensure `ELECTRON_DISABLE_SANDBOX=1` is set (it should be by default)
2. For headless tests, xvfb is available: `xvfb-run npm run test:e2e`

### Claude Code issues

1. Check API key is configured: `claude config`
2. Verify network access to api.anthropic.com
3. Check logs in `/home/node/.claude/`

## Working Outside the Container

You can still develop on your host machine normally:

1. Install dependencies on the host: `npm install`
2. Run builds, tests, etc. on the host
3. Use your preferred editor/IDE

The devcontainer's volume mounts ensure no conflicts with host development.

## Customization

### Adding npm packages to allowlist

Edit `.devcontainer/init-firewall.sh` and add domains to the `DOMAINS` array.

### Changing Node.js version

Edit `.devcontainer/Dockerfile` and change the `FROM node:24` line.

### Adding VS Code extensions

Edit `.devcontainer/devcontainer.json` in the `customizations.vscode.extensions` array.

## Resources

- [Claude Code Documentation](https://docs.claude.com/en/docs/claude-code)
- [Anthropic devcontainer-features](https://github.com/anthropics/devcontainer-features)
- [VS Code Dev Containers](https://code.visualstudio.com/docs/devcontainers/containers)
