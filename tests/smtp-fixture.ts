import { createServer, type AddressInfo, type Socket } from 'node:net';
import type { MailSettings } from '../shared/types.js';

export async function startTestSmtp() {
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  const control = { fail: false };
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '', data = false, body = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const at = buffer.indexOf('\r\n'), line = buffer.slice(0, at); buffer = buffer.slice(at + 2);
        if (data) {
          if (line === '.') { messages.push(body); body = ''; data = false; socket.write('250 message accepted\r\n'); }
          else body += line.replace(/^\.\./, '.') + '\r\n';
        } else if (/^(EHLO|HELO)/.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH')) socket.write('235 authenticated\r\n');
        else if (line.startsWith('MAIL FROM') && control.fail) socket.write('550 sender rejected\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 send message\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const close=async()=>{ for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); };
  const settings: MailSettings = { enabled: true, host: '127.0.0.1', port: (server.address() as AddressInfo).port, encryption: 'none', username: 'tester', password: 'smtp-secret-for-test', fromEmail: 'sender@example.test', fromName: 'Test site', passwordReset: true, verification: true, quotaNotifications: true, reviewInbox: 'reviewer@example.test' };
  return { settings, messages, control, close };
}
