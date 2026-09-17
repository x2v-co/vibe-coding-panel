// Serve the production build. No Connector, user login, or desktop session is touched.
import express from 'express';
import path from 'node:path';
const app = express(), root = process.cwd();
app.get('/api/desktop-controller/view', (_req, res) => res.sendFile(path.join(root, 'dist/controller.html')));
app.use('/api/desktop-controller', express.static(path.join(root, 'dist')));
app.use(express.static(path.join(root, 'dist')));
app.get('/app', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
app.listen(4189, '127.0.0.1');
