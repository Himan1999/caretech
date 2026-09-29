# careTech

A lightweight service-booking and accessories storefront for customers who need practical help with phones, laptops, printers, and home technology.

The application combines a static browser interface with an Express API. Customers can browse services and products, create an account, place orders, and track notifications. Administrators can review orders, update statuses, and manage accessory inventory.

## Features

- Service catalogue for printer, laptop, and phone support
- Accessories storefront with category and brand filtering
- Customer registration and login
- Password hashing with Node.js `scrypt`
- Service bookings with address, preferred date, and notes
- Accessory stock tracking during checkout
- Customer order history and notifications
- Admin dashboard with order metrics and status updates
- Admin product creation and soft deletion
- Signed bearer tokens for authenticated API requests

## Technology

- Node.js
- Express 4
- Microsoft SQL Server
- `mssql` with `msnodesqlv8`
- Vanilla HTML, CSS, and JavaScript

## Requirements

- Node.js 18 or newer
- Microsoft SQL Server or SQL Server Express
- ODBC Driver 17 for SQL Server
- Windows integrated authentication access to the database
- A `CareTechDB` database with the tables used by `server.js`

The repository does not include database migrations or table-creation scripts. The database schema must be provisioned before starting the server.

## Installation

```powershell
npm install
```

Configure the connection in the environment, if the defaults do not match your machine:

```powershell
$env:PORT = "3000"
$env:SECRET = "replace-with-a-long-random-secret"
$env:CARETECH_SQL_SERVER = "localhost\SQLEXPRESS"
$env:CARETECH_SQL_DATABASE = "CareTechDB"
```

The application uses Windows integrated authentication through `msnodesqlv8`. Confirm that the Windows account running Node.js can connect to the configured SQL Server database.

## Run Locally

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

The server connects to SQL Server, seeds empty tables from `data.json`, and then starts the Express application. Seeding occurs only when the corresponding tables are empty.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port for the Express server |
| `SECRET` | `change-me-before-going-live` | HMAC secret used to sign authentication tokens |
| `CARETECH_SQL_SERVER` | `VALKYRIE1047\\SQLEXPRESS` | SQL Server instance name |
| `CARETECH_SQL_DATABASE` | `CareTechDB` | SQL Server database name |

Set a strong `SECRET` outside development. Do not use the default value in a deployed environment.

## Application Workflows

### Customers

1. Open the storefront and browse services or accessories.
2. Register with a name, email address, and password of at least six characters, or sign in.
3. Add services or in-stock accessories to the cart.
4. Provide service visit details when booking a service.
5. Submit the order and follow status updates from the order history.

### Administrators

Sign in with an account whose database role is `admin`. The admin dashboard provides order summaries, status management, and accessory inventory management.

Do not commit administrator passwords or password hashes as documentation. Credentials should be issued or reset through an authorized account-management process.

## API Overview

| Method | Endpoint | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/catalog` | Public | List active services and products |
| `POST` | `/api/register` | Public | Create a customer account |
| `POST` | `/api/login` | Public | Authenticate a user |
| `POST` | `/api/orders` | Bearer token | Create an order |
| `GET` | `/api/orders` | Bearer token | List the current user's orders |
| `GET` | `/api/notifications` | Bearer token | List user notifications |
| `PATCH` | `/api/notifications/:id/read` | Bearer token | Mark a notification as read |
| `GET` | `/api/admin/summary` | Admin token | Read dashboard metrics |
| `PATCH` | `/api/orders/:id` | Admin token | Update an order status |
| `POST` | `/api/products` | Admin token | Add an accessory |
| `DELETE` | `/api/products/:id` | Admin token | Deactivate an accessory |

Authenticated requests use the token returned by login or registration:

```http
Authorization: Bearer <token>
```

## Project Structure

```text
.
├── data.json          # Seed data for users, services, and products
├── package.json       # Dependencies and npm scripts
├── server.js          # Express server, authentication, API, and database access
└── public/
    └── index.html     # Browser application
```

## Security Notes

- Set `SECRET` to a long, random value before deployment.
- Keep database connection details outside source control where possible.
- Passwords are stored as salted `scrypt` hashes; the original passwords cannot be recovered from the stored values.
- Use HTTPS and a production-grade secret-management solution when deploying publicly.
- Review `data.json` before publishing because it contains seed account metadata and should not be treated as a production credential store.

## Development

The project currently exposes a single `npm start` script and does not include an automated test suite or database migration tooling. Changes to authentication, order totals, stock updates, or admin authorization should be verified against a configured SQL Server database before deployment.
