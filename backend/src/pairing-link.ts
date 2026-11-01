/** What the pairing QR code holds. PairingDetails.fromQr in the app reads it. */
export function pairingLink(address: string, code: string): string {
  return `buddy://pair?address=${encodeURIComponent(address)}&code=${encodeURIComponent(code)}`;
}
