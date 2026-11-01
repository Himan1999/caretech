# Project Structure

The repository keeps the existing Express application together under `apps/web`:

- `server.js` serves the static browser pages, exposes the API, and connects to SQL Server.
- `public/` contains the customer and administrator pages.
- `data.json` provides seed data for empty SQL Server tables.

The root `package.json` remains the single dependency and script entry point, so install and run commands stay the same:

```powershell
npm install
npm start
```

The start script launches `apps/web/server.js`. Static files and seed data are resolved relative to that file, so starting the app from the repository root or another working directory uses the same paths.
