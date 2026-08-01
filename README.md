# OpenPOS

OpenPOS is a free, open source Point-of-Sale (POS) web application you can run from a folder or host on GitHub Pages/Web server. It works offline, supports multiple users and roles, receipts and reports, barcode scanning, and persistent disk backups so your data survives clearing browser storage.

<img width="1917" height="942" alt="image" src="https://github.com/user-attachments/assets/0032f014-514d-4925-826a-29f7c8be95c7" />

<img width="1791" height="985" alt="image" src="https://github.com/user-attachments/assets/cce4b5aa-e0e5-45ec-8185-bfa8b3b82a14" />


## Auto save (Enable persistent save)
The auto-save function is optimized and designed for local/offline environments.
While it may encounter errors when hosted on a live web server, you can always manually manage your data via the following options:
- Save AppData to file (AppData.json)
- Load AppData from AppData file
- Choose AppData file (for auto-save)

## Key features
- Zero-build: run by opening index.html (or host on GitHub Pages)
- Offline-first: service worker and PWA install support
- Local storage (IndexedDB) with optional AppData.json disk backup for file:// runs
- Multi-user accounts with roles (Admin, Manager, Cashier) and security-question password recovery
- Products, categories, customers, cart/checkout, sales recording and printable receipts
- Live camera barcode scanning (where supported) and CSV import/export for products/customers
- Sales & Reports with CSV (Excel) and PDF export
- Theme, language and currency selection

## Quick start
1. Download or clone the repository and extract the files to a folder.
2. Open `index.html` in a modern browser (Chrome/Edge recommended for full features).
3. On first run create an Admin account. The app will guide you through setup.
4. To make backups that survive clearing browser data: use Settings → Choose AppData file (or Export Backup). On file:// runs the app will try to load `AppData.json` from the same folder automatically.
5. To install the app on your device, host the folder on GitHub Pages or use the browser "Install" prompt when available.

## Backups & persistence
- The app stores data in your browser (IndexedDB). If you clear browser data you can restore from an exported backup or an AppData.json file saved to disk.
- For strong persistence on local file runs (file://), place an `AppData.json` file in the same folder or use Settings → Choose AppData file to save to disk.

## Privacy & Security
All data remains on your device. Passwords and security answers are hashed using the Web Crypto API before storage. Encrypted backups (AES-GCM) are supported when exporting.

## License
OpenPOS is released under the GNU General Public License v3.0 (GPL-3.0).

If you found OpenPOS useful or want to contribute, open an issue or pull request on the repository. Enjoy!
