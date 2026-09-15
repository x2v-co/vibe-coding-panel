// Initialize before the first controller request, including on a regional product origin.
window.controllerTransportReady = import('/api/desktop-controller/relay-transport.js').then(async transport => {
  await transport.initializeRelayTransport();
  return transport.apiFetch;
});
// Keep a rejected initialization observable by requests without an unhandled rejection.
window.controllerTransportReady.catch(() => {});
