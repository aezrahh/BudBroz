# Apps (next phase)

| App | Stack | Purpose |
| --- | --- | --- |
| `customer` | Next.js PWA | Find stores, browse menus, cart with limits, ID pre-verification, checkout, live tracking |
| `merchant` | Next.js | Dispensary portal: menu and inventory, accept or reject orders, order history |
| `driver` | Expo (React Native) | Go online, receive offers, navigation, door ID scan, photo check, signature |
| `admin` | Next.js | Licenses, couriers and drivers, town allow-list, audit log |

All apps talk to `services/api` and share types from `packages/compliance`.
