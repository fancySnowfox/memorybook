function config(req, res) {
  res.json({
    status: 'ok',
    version: '0.1.0',
  });
}

export const configRoutes = { config };
