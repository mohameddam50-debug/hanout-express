const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hanout', {
  audit: { list: (limit) => ipcRenderer.invoke('audit:list', limit) },
  accounts: { list: () => ipcRenderer.invoke('accounts:list'), create: (data) => ipcRenderer.invoke('accounts:create', data), ledger: (data) => ipcRenderer.invoke('accounts:ledger', data) },
  journal: { list: (data) => ipcRenderer.invoke('journal:list', data), get: (id) => ipcRenderer.invoke('journal:get', id), create: (data) => ipcRenderer.invoke('journal:create', data) },
  accounting: { reports: (data) => ipcRenderer.invoke('accounting:reports', data), reconciliation: () => ipcRenderer.invoke('accounting:reconciliation'), period: { get: () => ipcRenderer.invoke('accounting:period:get'), update: (data) => ipcRenderer.invoke('accounting:period:update', data), check: (data) => ipcRenderer.invoke('accounting:period:check', data) } },
  auth: { status: () => ipcRenderer.invoke('auth:status'), logout: () => ipcRenderer.invoke('auth:logout'), login: (data) => ipcRenderer.invoke('auth:login', data), users: { list: () => ipcRenderer.invoke('auth:users:list'), create: (data) => ipcRenderer.invoke('auth:users:create', data), update: (data) => ipcRenderer.invoke('auth:users:update', data), changePassword: (data) => ipcRenderer.invoke('auth:users:password', data), remove: (id) => ipcRenderer.invoke('auth:users:delete', id) } },
  products: {
    list: () => ipcRenderer.invoke('products:list'),
    create: (data) => ipcRenderer.invoke('products:create', data),
    update: (data) => ipcRenderer.invoke('products:update', data),
    delete: (id) => ipcRenderer.invoke('products:delete', id)
  },
  categories: {
    list: () => ipcRenderer.invoke('categories:list'),
    create: (data) => ipcRenderer.invoke('categories:create', data),
    update: (data) => ipcRenderer.invoke('categories:update', data),
    delete: (id) => ipcRenderer.invoke('categories:delete', id)
  },
  expenses: { list: (limit) => ipcRenderer.invoke('expenses:list', limit), create: (data) => ipcRenderer.invoke('expenses:create', data), delete: (id) => ipcRenderer.invoke('expenses:delete', id) },
  cash: { current: () => ipcRenderer.invoke('cash:current'), open: (data) => ipcRenderer.invoke('cash:open', data), close: (data) => ipcRenderer.invoke('cash:close', data), history: (limit) => ipcRenderer.invoke('cash:history', limit) },
  reports: { summary: (data) => ipcRenderer.invoke('reports:summary', data) },
  customers: { list: () => ipcRenderer.invoke('customers:list'), create: (data) => ipcRenderer.invoke('customers:create', data), update: (data) => ipcRenderer.invoke('customers:update', data), delete: (id) => ipcRenderer.invoke('customers:delete', id), pay: (data) => ipcRenderer.invoke('customers:pay', data), statement: (id) => ipcRenderer.invoke('customers:statement', id) },
  suppliers: { list: () => ipcRenderer.invoke('suppliers:list'), create: (data) => ipcRenderer.invoke('suppliers:create', data), update: (data) => ipcRenderer.invoke('suppliers:update', data), delete: (id) => ipcRenderer.invoke('suppliers:delete', id), pay: (data) => ipcRenderer.invoke('suppliers:pay', data), statement: (id) => ipcRenderer.invoke('suppliers:statement', id) },
  purchases: { list: (limit) => ipcRenderer.invoke('purchases:list', limit), get: (id) => ipcRenderer.invoke('purchases:get', id), create: (data) => ipcRenderer.invoke('purchases:create', data) },
  sales: { list: (limit) => ipcRenderer.invoke('sales:list', limit), get: (id) => ipcRenderer.invoke('sales:get', id), create: (data) => ipcRenderer.invoke('sales:create', data), return: (data) => ipcRenderer.invoke('sales:return', data), cancel: (data) => ipcRenderer.invoke('sales:cancel', data) },
  settings: { get: () => ipcRenderer.invoke('settings:get'), update: (data) => ipcRenderer.invoke('settings:update', data) },
  backup: { create: () => ipcRenderer.invoke('backup:create'), restore: () => ipcRenderer.invoke('backup:restore') },
  receipts: { exportPdf: (invoiceNo, payload) => ipcRenderer.invoke('receipts:export-pdf', invoiceNo, payload) },
  printers: { list: () => ipcRenderer.invoke('printers:list'), print: (payload) => ipcRenderer.invoke('printers:print', payload) },
  images: { select: () => ipcRenderer.invoke('images:select'), read: (imagePath) => ipcRenderer.invoke('images:read', imagePath) }
});
