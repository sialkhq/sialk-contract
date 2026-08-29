/**
 * Where the shim gets audio from.
 *
 * Both of the shim's dependencies — where audio comes from, and when frames
 * tick — are pluggable, because outside Sialk they genuinely vary. A sketch
 * author on a laptop wants the microphone; someone rendering a sketch to video
 * offline wants their own sample blocks and their own clock; a test wants both
 * to be deterministic. One seam serves all three.
 */

export interface ShimAudioSource {
  readonly sampleRate: number;
  /** Fills `into` with the most recent block of mono samples, -1..1. */
  read(into: Float32Array<ArrayBuffer>): void;
  close(): void;
}

export type ShimSource =
  | { kind: 'microphone' }
  | { kind: 'element'; element: HTMLMediaElement }
  | { kind: 'url'; url: string; loop?: boolean }
  | { kind: 'silent' }
  | { kind: 'custom'; create(): ShimAudioSource | Promise<ShimAudioSource> };

export function normaliseSource(
  source: ShimSource | 'microphone' | 'silent' | undefined,
): ShimSource {
  if (source === undefined) return { kind: 'microphone' };
  if (typeof source === 'string') return { kind: source };
  return source;
}

export function createSilentSource(sampleRate = 48_000): ShimAudioSource {
  return {
    sampleRate,
    read: (into) => into.fill(0),
    close: () => {},
  };
}

export async function connectSource(source: ShimSource, fftSize: number): Promise<ShimAudioSource> {
  if (source.kind === 'silent') return createSilentSource();
  if (source.kind === 'custom') return source.create();

  const context = new AudioContext();
  const analyserNode = context.createAnalyser();
  analyserNode.fftSize = fftSize;
  // The contract's own smoothing is documented and asymmetric. Letting the
  // browser smooth first would make the documented behaviour a lie.
  analyserNode.smoothingTimeConstant = 0;

  let cleanup = (): void => {};

  if (source.kind === 'microphone') {
    const stream = await navigator.mediaDevices.getUserMedia({
      // Every one of these fights the analysis: they are built to make speech
      // intelligible, not to leave music intact.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    context.createMediaStreamSource(stream).connect(analyserNode);
    cleanup = () => stream.getTracks().forEach((track) => track.stop());
  } else if (source.kind === 'element') {
    const node = context.createMediaElementSource(source.element);
    node.connect(analyserNode);
    // A media element routed through Web Audio goes silent unless it is also
    // connected to the destination.
    node.connect(context.destination);
  } else {
    const element = new Audio(source.url);
    element.crossOrigin = 'anonymous';
    element.loop = source.loop ?? true;
    const node = context.createMediaElementSource(element);
    node.connect(analyserNode);
    node.connect(context.destination);
    await element.play();
    cleanup = () => element.pause();
  }

  // Browsers start the context suspended until a gesture. Try, and let the
  // sketch run silently rather than throwing if the gesture has not happened.
  void context.resume().catch(() => {});

  return {
    sampleRate: context.sampleRate,
    read: (into) => analyserNode.getFloatTimeDomainData(into),
    close: () => {
      cleanup();
      void context.close().catch(() => {});
    },
  };
}
