# OpenPOS - Free and Open Source POS 🩵

OpenPOS is a free, open source Point-of-Sale (POS) web application you can run from a folder or host on GitHub Pages/Web server. It works offline, supports multiple users and roles, receipts and reports, barcode scanning, and persistent disk backups so your data survives clearing browser storage.

>
<img width="1919" height="1004" alt="image" src="https://github.com/user-attachments/assets/f2fa62c2-616d-4196-a21a-ad5f9ae65b5c" />

>
<img width="1920" height="1000" alt="image" src="https://github.com/user-attachments/assets/41a1f428-92a5-4724-b54e-4e400d223d03" />

>
<img width="1920" height="1000" alt="image" src="https://github.com/user-attachments/assets/66dd01f2-aa4c-4339-b332-fef50de40a5a" />


## ⚠️ Auto save (Enable persistent save) ⚠️
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
1. Download 'OpenPOS App V3.0.0.zip' file or clone the repository and extract the files to a folder. 
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
