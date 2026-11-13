# Contributing to Kash Spending Tracker

Thank you for your interest in contributing!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/kash-spending-tracker.git`
3. Install dependencies: `pnpm install`
4. Run development server: `pnpm dev`

## Development Workflow

### Branching

- Use descriptive branch names: `feat/feature-name`, `fix/bug-fix-description`
- Create a feature branch from main
- Submit a pull request when ready

### Code Style

- TypeScript with strict mode enabled
- Prettier for formatting (see `.prettierrc`)
- ESLint for linting (see `eslint.config.js`)
- Follow existing code patterns in the codebase

### Testing

- Write tests before or alongside code changes
- Run tests with: `pnpm test`
- E2E tests with Playwright: `pnpm test:e2e`

## Commit Messages

Follow conventional commits:

- `feat:` - New features
- `fix:` - Bug fixes
- `chore:` - Maintenance tasks
- `docs:` - Documentation changes

Example: `feat(m0): add budget tracking feature`

## Pull Requests

1. Ensure all tests pass
2. Update documentation if needed
3. Provide clear description of changes
4. Reference related issues
5. Request review from maintainers

## Code Review

Reviewers will check for:

- Correctness and functionality
- Code quality and style
- Test coverage
- Security implications
- Documentation updates

## Questions?

Feel free to open an issue or discussion for questions about the project.
