# findev-test

This project was generated with [Analog](https://analogjs.org), the fullstack meta-framework for Angular.

## Setup

Run `pnpm install` to install the application dependencies.

### Blocked dependency builds

The following dependencies have their install/postinstall scripts explicitly disabled with `allowBuilds: false` in `pnpm-workspace.yaml`:

- `@parcel/watcher`
- `esbuild`
- `lmdb`
- `msgpackr-extract`

These scripts build or configure platform-specific components. The packages are still installed, but pnpm does not run their build scripts. Use pnpm for installation so this policy is applied.

If a dependency requires its build script, review the script, set that package's `allowBuilds` entry to `true`, and run `pnpm rebuild <package>`. For example, after allowing `esbuild`, run `pnpm rebuild esbuild`.

## Development

Run `npm start` for a dev server. Navigate to `http://localhost:5173/`. The application automatically reloads if you change any of the source files.

## Build

Run `npm run build` to build the client/server project. The client build artifacts are located in the `dist/analog/public` directory. The server for the API build artifacts are located in the `dist/analog/server` directory.

## Community

- Visit and Star the [GitHub Repo](https://github.com/analogjs/analog)
- Join the [Discord](https://chat.analogjs.org)
- Follow us on [Twitter](https://twitter.com/analogjs)
- Become a [Sponsor](https://github.com/sponsors/brandonroberts)
