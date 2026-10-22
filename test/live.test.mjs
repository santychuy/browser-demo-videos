import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { collectLiveSpeech } from "../skills/browser-demo-videos/scripts/lib/live.mjs";
import { assertTranscriptMatches } from "../skills/browser-demo-videos/scripts/lib/transcript.mjs";

const script = "Review the two projects, then export.";
const session = {
  id: "live_independent_fixture",
  model: "gpt-live-1",
  audio: {
    format: { type: "audio/pcm", rate: 24000 },
    output: { voice: "marin" },
  },
};

// Only transport mechanics are simulated. Server events and their order are
// supplied independently by each test; this socket never echoes the prompt or
// fabricates a provider reply from a client command.
class ServerSocket extends EventEmitter {
  readyState = 0;
  bufferedAmount = 0;
  sent = [];
  terminations = 0;

  send(data, callback) {
    this.sent.push(JSON.parse(data));
    callback?.();
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  receive(event) {
    this.emit("message", Buffer.from(JSON.stringify(event)), false);
  }

  disconnect() {
    this.readyState = 3;
    this.emit("close", 1006, Buffer.from("private upstream reason"));
  }

  terminate() {
    this.terminations += 1;
    this.readyState = 3;
    this.emit("close", 1006, Buffer.alloc(0));
  }

  count(type) {
    return this.sent.filter((event) => event.type === type).length;
  }
}

function boundary(t, { start = true } = {}) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 0 });
  const socket = new ServerSocket();
  const result = collectLiveSpeech(socket, { voice: "marin", text: script });
  socket.open();
  if (start) socket.receive({ type: "session.started", session });
  return { socket, result };
}

function speech(samples = 2400, scale = 1) {
  const bytes = Buffer.alloc(samples * 2);
  const waveform = [900, -1200, 1500, -700];
  for (let index = 0; index < samples; index += 1)
    bytes.writeInt16LE(waveform[index % waveform.length] * scale, index * 2);
  return bytes;
}

function audio(socket, bytes) {
  socket.receive({
    type: "session.output_audio.delta",
    delta: bytes.toString("base64"),
  });
}

function transcript(socket, delta, start_ms = 90000, end_ms = 91000) {
  // Deliberately unrelated to accumulated PCM duration: these are approximate
  // session timeline positions, not a promise about a primary PCM byte clock.
  socket.receive({
    type: "session.output_transcript.delta",
    delta,
    start_ms,
    end_ms,
  });
}

function terminal(socket, overrides = {}) {
  socket.receive({
    type: "session.closed",
    reason: "close_requested",
    usage: { seconds: 3.75 },
    session: { id: session.id },
    ...overrides,
  });
}

function completeOutput(socket, text = script) {
  audio(socket, speech());
  transcript(socket, text);
  audio(socket, Buffer.alloc(48000));
}

function expectClose(t, socket) {
  t.mock.timers.tick(1500);
  assert.equal(socket.count("session.close"), 1);
}

test("Live preserves ordered PCM and late transcript/audio through close, with final safe accounting", async (t) => {
  const { socket, result } = boundary(t);
  const first = speech();
  const quietA = Buffer.alloc(24000);
  const quietB = Buffer.alloc(24000);
  const last = speech(1200, 2);
  const drainQuiet = Buffer.alloc(48000);
  audio(socket, first);
  transcript(socket, "Review the two projects, then ");
  audio(socket, quietA);
  t.mock.timers.tick(500);
  audio(socket, quietB);
  t.mock.timers.tick(500);
  const ongoingQuiet = Buffer.alloc(4800);
  audio(socket, ongoingQuiet);
  assert.equal(socket.count("session.close"), 0);
  t.mock.timers.tick(500);
  assert.equal(socket.count("session.close"), 1);
  const sentAtClose = socket.sent.length;
  t.mock.timers.tick(500);
  assert.equal(
    socket.sent.length,
    sentAtClose,
    "no input continues while awaiting finalization",
  );
  audio(socket, last);
  transcript(socket, "export.", 150000, 151000);
  audio(socket, drainQuiet);
  socket.receive({ type: "session.usage.updated", usage: { seconds: 2 } });
  terminal(socket);
  const { audio: wav, transcript: delivered, metadata } = await result;
  const expectedPcm = Buffer.concat([
    first,
    quietA,
    quietB,
    ongoingQuiet,
    last,
    drainQuiet,
  ]);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt32LE(16), 16);
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(28), 48000);
  assert.equal(wav.readUInt16LE(32), 2);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(40), expectedPcm.length);
  assert.deepEqual(wav.subarray(44), expectedPcm);
  assert.equal(delivered, script);
  assert.deepEqual(metadata, {
    model: "gpt-live-1",
    voice: "marin",
    sampleRate: 24000,
    sessionId: "live_independent_fixture",
    usageSeconds: 3.75,
    closeReason: "close_requested",
    completionMethod:
      "received-quiet-audio-tail-and-stable-transcript-heuristic",
    transcriptEvents: [
      { delta: "Review the two projects, then ", startMs: 90000, endMs: 91000 },
      { delta: "export.", startMs: 150000, endMs: 151000 },
    ],
  });
  assert.equal(socket.terminations, 1);
  assert.equal(socket.listenerCount("message"), 0);
  t.mock.timers.tick(200000);
  assert.equal(socket.sent.length, sentAtClose);
});

test("Live clocks only after session.started and accepts paused output only with real quiet tail", async (t) => {
  const { socket, result } = boundary(t, { start: false });
  t.mock.timers.tick(500);
  assert.equal(socket.count("session.input_audio.append"), 0);
  assert.equal(socket.count("session.instructions.append"), 0);
  socket.receive({ type: "session.started", session });
  assert.equal(socket.count("session.input_audio.append"), 1);
  t.mock.timers.tick(99);
  assert.equal(socket.count("session.input_audio.append"), 1);
  t.mock.timers.tick(1);
  assert.equal(socket.count("session.input_audio.append"), 2);
  for (const event of socket.sent.filter(
    (item) => item.type === "session.input_audio.append",
  )) {
    const input = Buffer.from(event.audio, "base64");
    assert.equal(input.length, 4800);
    assert.equal(
      input.some((byte) => byte !== 0),
      false,
    );
  }
  completeOutput(socket);
  t.mock.timers.tick(1499);
  assert.equal(socket.count("session.close"), 0);
  t.mock.timers.tick(1);
  assert.equal(socket.count("session.close"), 1);
  terminal(socket);
  assert.equal((await result).transcript, script);
});

test("Live transcript arrival postpones settling without pretending its timestamps are PCM offsets", async (t) => {
  const { socket, result } = boundary(t);
  audio(socket, speech());
  audio(socket, Buffer.alloc(48000));
  t.mock.timers.tick(1000);
  transcript(socket, script, 500000, 500100);
  t.mock.timers.tick(1499);
  assert.equal(socket.count("session.close"), 0);
  t.mock.timers.tick(1);
  assert.equal(socket.count("session.close"), 1);
  terminal(socket);
  assert.equal((await result).metadata.transcriptEvents[0].startMs, 500000);
});

test("Live checks the whole transcript after drain, rejecting extra late words rather than a matching prefix", async (t) => {
  const { socket, result } = boundary(t);
  const rejection = assert.rejects(result, (error) => {
    assert.match(error.message, /transcript does not match.*no fallback/);
    assert.deepEqual(error.metadata, {
      sessionId: "live_independent_fixture",
      usageSeconds: 3.75,
      closeReason: "close_requested",
    });
    assert.equal(Object.hasOwn(error, "audio"), false);
    return true;
  });
  completeOutput(socket);
  expectClose(t, socket);
  transcript(socket, " Thank you.", 151000, 152000);
  terminal(socket);
  await rejection;
  assert.equal(socket.terminations, 1);
});

test("shared transcript equality normalizes Unicode and punctuation, never words, order or numbers", () => {
  assert.doesNotThrow(() =>
    assertTranscriptMatches(
      "Café: review ２ projects!",
      "CAFE\u0301 — review 2 projects.",
      "Narration",
    ),
  );
  for (const actual of [
    "Café review two projects",
    "Café review 3 projects",
    "Café 2 review projects",
    "Café review 2 projects again",
    "Café review 2",
    "Café review review 2 projects",
    "",
    "!!!",
  ])
    assert.throws(
      () =>
        assertTranscriptMatches("Café review 2 projects", actual, "Narration"),
      /transcript does not match/,
    );
  assert.throws(
    () => assertTranscriptMatches("...", "...", "Narration"),
    /transcript does not match/,
  );
});

test("Live never treats silence, a short tail, or packet inactivity as complete speech", async (t) => {
  for (const variant of ["silence", "no-tail", "short-tail", "single-click"]) {
    await t.test(variant, async (t) => {
      const { socket, result } = boundary(t);
      const rejection = assert.rejects(
        result,
        /capture timed out.*no fallback/,
      );
      transcript(socket, script);
      if (variant === "silence") audio(socket, Buffer.alloc(96000));
      else if (variant === "single-click") {
        audio(socket, speech(1));
        audio(socket, Buffer.alloc(48000));
      } else {
        audio(socket, speech());
        if (variant === "short-tail") audio(socket, Buffer.alloc(24000));
      }
      t.mock.timers.tick(89999);
      assert.equal(socket.count("session.close"), 0);
      t.mock.timers.tick(1);
      assert.equal(socket.count("session.close"), 1);
      terminal(socket);
      await rejection;
      const sends = socket.sent.length;
      t.mock.timers.tick(200000);
      assert.equal(socket.sent.length, sends);
    });
  }
});

test("Live requires terminal close reason and final usage instead of socket closure or interim usage", async (t) => {
  const cases = [
    ["missing usage", { usage: undefined }],
    ["invalid usage", { usage: { seconds: -1 } }],
    ["non-numeric usage", { usage: { seconds: "3" } }],
    ["non-requested reason", { reason: "connection_lost" }],
    ["contradictory model", { session: { model: "other" } }],
    [
      "contradictory voice",
      { session: { audio: { output: { voice: "stone" } } } },
    ],
  ];
  for (const [name, override] of cases) {
    await t.test(name, async (t) => {
      const { socket, result } = boundary(t);
      const rejection = assert.rejects(
        result,
        /session.closed|terminal session configuration/,
      );
      completeOutput(socket);
      socket.receive({ type: "session.usage.updated", usage: { seconds: 3 } });
      expectClose(t, socket);
      terminal(socket, override);
      await rejection;
      assert.equal(socket.terminations, 1);
    });
  }
});

test("Live fails unconfirmed transport finalization and bounded terminal waits", async (t) => {
  for (const variant of [
    "early-disconnect",
    "close-disconnect",
    "missing-terminal",
    "startup-timeout",
  ]) {
    await t.test(variant, async (t) => {
      const { socket, result } = boundary(t, {
        start: variant !== "startup-timeout",
      });
      const rejection = assert.rejects(
        result,
        /finalization was not confirmed/,
      );
      if (variant === "startup-timeout") t.mock.timers.tick(20000);
      else if (variant === "early-disconnect") socket.disconnect();
      else {
        completeOutput(socket);
        expectClose(t, socket);
        if (variant === "close-disconnect") socket.disconnect();
        else {
          t.mock.timers.tick(14999);
          assert.equal(socket.terminations, 0);
          t.mock.timers.tick(1);
        }
      }
      await rejection;
      assert.equal(socket.readyState, 3);
      assert.equal(socket.listenerCount("message"), 0);
      const sends = socket.sent.length;
      t.mock.timers.tick(200000);
      assert.equal(socket.sent.length, sends);
    });
  }
});

test("Live refuses malformed audio and protocol events, draining a requested close without exposing raw errors", async (t) => {
  const failures = [
    [
      "invalid base64",
      (socket) =>
        socket.receive({ type: "session.output_audio.delta", delta: "!!!!" }),
      /malformed PCM/,
    ],
    [
      "noncanonical base64",
      (socket) =>
        socket.receive({ type: "session.output_audio.delta", delta: "AB==" }),
      /malformed PCM/,
    ],
    [
      "odd PCM",
      (socket) => audio(socket, Buffer.from([1, 2, 3])),
      /malformed PCM/,
    ],
    [
      "missing transcript timing",
      (socket) =>
        socket.receive({
          type: "session.output_transcript.delta",
          delta: script,
        }),
      /malformed transcript/,
    ],
    [
      "backward transcript timing",
      (socket) => transcript(socket, script, 5, 4),
      /malformed transcript/,
    ],
    [
      "malformed JSON",
      (socket) =>
        socket.emit(
          "message",
          Buffer.from("private-secret-invalid-json"),
          false,
        ),
      /malformed event JSON/,
    ],
    [
      "binary frame",
      (socket) => socket.emit("message", Buffer.from([0, 1]), true),
      /unsupported WebSocket/,
    ],
    [
      "oversized message",
      (socket) =>
        socket.receive({
          type: "session.output_audio.delta",
          delta: "A".repeat(2 * 1024 * 1024),
        }),
      /safety byte limit/,
    ],
    [
      "oversized transcript",
      (socket) => transcript(socket, "x".repeat(100001)),
      /safety size limit/,
    ],
    [
      "provider error",
      (socket) =>
        socket.receive({
          type: "error",
          error: {
            message: "private-secret-provider-error",
            headers: { Authorization: "private-secret-key" },
          },
        }),
      /provider returned an error/,
    ],
    [
      "transport error",
      (socket) =>
        socket.emit("error", new Error("private-secret-network-error")),
      /transport failed/,
    ],
    [
      "delegation",
      (socket) =>
        socket.receive({
          type: "session.delegation.created",
          delegation: { instructions: "private-secret-tool-call" },
        }),
      /no tools or backends were executed/,
    ],
  ];
  for (const [name, trigger, diagnostic] of failures) {
    await t.test(name, async (t) => {
      const { socket, result } = boundary(t);
      const rejection = assert.rejects(result, (error) => {
        assert.match(error.message, diagnostic);
        assert.doesNotMatch(error.message, /private-secret/);
        return true;
      });
      trigger(socket);
      assert.equal(socket.count("session.close"), 1);
      // Receiving more events while closing must not replace the original
      // diagnostic, execute delegation, or issue a second close command.
      transcript(socket, script);
      terminal(socket);
      await rejection;
      assert.equal(socket.count("session.close"), 1);
      assert.equal(
        socket.sent.some((event) =>
          /delegation|response|tool/.test(event.type),
        ),
        false,
      );
    });
  }
});

test("Live closes incompatible started sessions instead of silently accepting a different model or format", async (t) => {
  const { socket, result } = boundary(t, { start: false });
  const rejection = assert.rejects(
    result,
    /unexpected session model, voice or audio format/,
  );
  socket.receive({
    type: "session.started",
    session: {
      ...session,
      audio: { ...session.audio, format: { type: "audio/pcm", rate: 48000 } },
    },
  });
  assert.equal(socket.count("session.close"), 1);
  assert.equal(socket.count("session.input_audio.append"), 0);
  terminal(socket);
  await rejection;
});

test("Live rejects output before startup and unsolicited terminal closure", async (t) => {
  for (const variant of ["premature-output", "unsolicited-terminal"]) {
    await t.test(variant, async (t) => {
      const { socket, result } = boundary(t, {
        start: variant !== "premature-output",
      });
      const rejection = assert.rejects(
        result,
        /before session.started|before the application confirmed/,
      );
      if (variant === "premature-output") audio(socket, speech());
      else terminal(socket);
      await rejection;
      assert.equal(socket.readyState, 3);
    });
  }
});

test("Live cleans up failed sends and rejected handshakes without exposing transport details", async (t) => {
  await t.test("send callback error", async (t) => {
    const { socket, result } = boundary(t);
    const rejection = assert.rejects(result, /transport send failed/);
    const normalSend = socket.send;
    let rejectNext = true;
    socket.send = function (data, callback) {
      if (rejectNext) {
        rejectNext = false;
        this.sent.push(JSON.parse(data));
        callback(new Error("private-secret-send-error"));
      } else normalSend.call(this, data, callback);
    };
    t.mock.timers.tick(100);
    assert.equal(socket.count("session.close"), 1);
    terminal(socket);
    await rejection;
    const sent = socket.sent.length;
    t.mock.timers.tick(200000);
    assert.equal(socket.sent.length, sent);
    assert.equal(socket.terminations, 1);
  });
  await t.test("HTTP rejection", async (t) => {
    const { socket, result } = boundary(t, { start: false });
    const rejection = assert.rejects(result, (error) => {
      assert.match(error.message, /HTTP 403.*finalization was not confirmed/);
      assert.doesNotMatch(error.message, /private-secret/);
      return true;
    });
    let drained = false;
    socket.emit(
      "unexpected-response",
      { headers: { Authorization: "private-secret-key" } },
      {
        statusCode: 403,
        statusMessage: "private-secret-server-message",
        resume() {
          drained = true;
        },
      },
    );
    await rejection;
    assert.equal(drained, true);
    assert.equal(socket.readyState, 3);
    assert.equal(socket.count("session.close"), 0);
  });
});
