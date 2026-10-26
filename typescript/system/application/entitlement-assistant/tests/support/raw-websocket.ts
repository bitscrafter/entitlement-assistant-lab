import { connect, type Socket } from "node:net";

/** A text-frame WebSocket client over a raw TCP connection, so a test sees the server's real handshake (RFC 6455). */
export class RawWebSocket {
  readonly #socket: Socket;
  readonly #listeners: ((event: { data: string }) => void)[] = [];
  /** Messages that arrived before any listener, delivered to the first one, as a browser's WebSocket would. */
  readonly #pending: string[] = [];
  /** The close frame the server sent, once it has. */
  closedWith: { readonly code: number; readonly reason: string } | null = null;
  #buffer = Buffer.alloc(0);

  constructor(socket: Socket, initial: Buffer) {
    this.#socket = socket;
    socket.on("data", (chunk: Buffer) => this.#receive(chunk));
    if (initial.length > 0) this.#receive(initial);
  }

  /** The server side accepts; a client has nothing to do. */
  accept(): void {}

  addEventListener(_type: "message", listener: (event: { data: string }) => void): void {
    this.#listeners.push(listener);
    for (const data of this.#pending.splice(0)) listener({ data });
  }

  send(text: string): void {
    this.#socket.write(frame(0x1, Buffer.from(text, "utf8")));
  }

  close(code = 1000, reason = ""): void {
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.#socket.write(frame(0x8, payload));
    this.#socket.end();
  }

  #deliver(data: string): void {
    if (this.#listeners.length === 0) this.#pending.push(data);
    for (const listener of this.#listeners) listener({ data });
  }

  #receive(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      if (this.#buffer.length < 2) return;
      const opcode = (this.#buffer[0] ?? 0) & 0x0f;
      let length = (this.#buffer[1] ?? 0) & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.#buffer.length < 4) return;
        length = this.#buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.#buffer.length < 10) return;
        length = Number(this.#buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.#buffer.length < offset + length) return;
      const payload = this.#buffer.subarray(offset, offset + length);
      this.#buffer = this.#buffer.subarray(offset + length);
      if (opcode === 0x1) this.#deliver(payload.toString("utf8"));
      if (opcode === 0x8) {
        this.closedWith = {
          code: payload.length >= 2 ? payload.readUInt16BE(0) : 1005,
          reason: payload.subarray(2).toString("utf8"),
        };
      }
    }
  }
}

/** A masked client frame, as RFC 6455 §5.3 requires of every frame a client sends. */
function frame(opcode: number, payload: Buffer): Buffer {
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const length = payload.length;
  const head =
    length < 126
      ? Buffer.from([0x80 | opcode, 0x80 | length])
      : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 126]), Buffer.from([length >> 8, length & 0xff])]);
  const masked = Buffer.from(payload.map((byte, index) => byte ^ (mask[index % 4] ?? 0)));
  return Buffer.concat([head, mask, masked]);
}

export interface RawUpgradeResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly webSocket: RawWebSocket | undefined;
  text(): Promise<string>;
}

/**
 * Sends one upgrade request, exactly as given, to a local server, and returns its response head.
 *
 * @ensures A `101` response carries the open WebSocket; any other carries its body.
 */
export function rawUpgrade(
  server: URL,
  path: string,
  headers: Readonly<Record<string, string>>,
): Promise<RawUpgradeResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(server.port), server.hostname);
    let received = Buffer.alloc(0);
    socket.on("error", reject);
    socket.on("connect", () => {
      const lines = [
        `GET ${path} HTTP/1.1`,
        `Host: ${server.host}`,
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      ];
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    });
    const onData = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const end = received.indexOf("\r\n\r\n");
      if (end < 0) return;
      socket.off("data", onData);
      const [statusLine = "", ...headerLines] = received.subarray(0, end).toString("latin1").split("\r\n");
      const status = Number(statusLine.split(" ")[1]);
      const responseHeaders = new Headers(
        headerLines.map((line) => [
          line.slice(0, line.indexOf(":")).trim(),
          line.slice(line.indexOf(":") + 1).trim(),
        ]),
      );
      const rest = received.subarray(end + 4);
      if (status === 101) {
        resolve({
          status,
          headers: responseHeaders,
          webSocket: new RawWebSocket(socket, rest),
          text: async () => "",
        });
        return;
      }
      let body = rest;
      socket.on("data", (more: Buffer) => {
        body = Buffer.concat([body, more]);
      });
      socket.on("end", () => undefined);
      setTimeout(() => socket.destroy(), 200);
      resolve({
        status,
        headers: responseHeaders,
        webSocket: undefined,
        text: async () => body.toString("utf8"),
      });
    };
    socket.on("data", onData);
  });
}
