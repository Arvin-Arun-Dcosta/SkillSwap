import { useCallback, useEffect, useRef, useState } from 'react';
import type { IceServer, MediaState, SignalPayload } from '@skillswap/shared';
import type { AppSocket } from '@/features/realtime/SocketProvider';

export type CallStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface Call {
  localStream: MediaStream | null;
  /** What the local preview should show: the screen while sharing, otherwise the camera. */
  previewStream: MediaStream | null;
  remoteStream: MediaStream | null;
  status: CallStatus;
  media: MediaState;
  /** Why camera or microphone are unavailable, in words for the member; null when fine. */
  mediaError: string | null;
  canShareScreen: boolean;
  toggleAudio: () => void;
  toggleVideo: () => void;
  toggleScreen: () => Promise<void>;
}

function describeMediaError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera and microphone access is blocked. Allow it in your browser’s site settings to be seen and heard.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera or microphone was found. You can still use chat, code, notes and the whiteboard.';
  }
  if (name === 'NotReadableError') {
    return 'Your camera or microphone is in use by another app.';
  }
  return 'Camera and microphone could not be started. You can still use the other tools.';
}

async function openLocalMedia(): Promise<{ stream: MediaStream | null; error: string | null }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, error: 'This browser cannot make calls. The other tools still work.' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    return { stream, error: null };
  } catch (first) {
    // No camera is common; a voice call is still better than nothing.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return { stream, error: 'No camera available: you are joining with audio only.' };
    } catch {
      return { stream: null, error: describeMediaError(first) };
    }
  }
}

/**
 * A one-to-one WebRTC call signalled through the session room.
 *
 * Uses the "perfect negotiation" pattern: either side may start negotiating at any time and
 * collisions are resolved by a fixed polite/impolite role, so there is no special caller or
 * callee and re-negotiation (screen share, late camera) just works. Media flows peer to peer;
 * the server only relays the handshake.
 */
export function useWebRTC(options: {
  socket: AppSocket | null;
  /** True once this client holds a seat in the room. */
  joined: boolean;
  polite: boolean;
  /** Changes whenever the other participant (re)joins; 0 while alone. */
  peerEpoch: number;
  peerPresent: boolean;
  iceServers: IceServer[];
  onMediaState: (state: MediaState) => void;
}): Call {
  const { socket, joined, polite, peerEpoch, peerPresent, iceServers, onMediaState } = options;

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  /** Signals that arrived before the peer connection existed. */
  const pendingSignals = useRef<SignalPayload[]>([]);
  const handleSignal = useRef<((signal: SignalPayload) => void) | null>(null);
  const iceRef = useRef(iceServers);
  useEffect(() => {
    iceRef.current = iceServers;
  }, [iceServers]);

  // 1. Camera and microphone: opened once, released when leaving the room.
  useEffect(() => {
    let cancelled = false;
    void openLocalMedia().then(({ stream, error }) => {
      if (cancelled) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      localRef.current = stream;
      setLocalStream(stream);
      setMediaError(error);
      setAudioOn(Boolean(stream?.getAudioTracks().length));
      setVideoOn(Boolean(stream?.getVideoTracks().length));
    });
    return () => {
      cancelled = true;
      localRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current?.getTracks().forEach((track) => track.stop());
      localRef.current = null;
      screenRef.current = null;
    };
  }, []);

  // 2. One listener for the whole stay; signals are queued until a connection can take them.
  useEffect(() => {
    if (!socket) return;
    const onSignal = ({ fromUserId: _from, ...signal }: SignalPayload & { fromUserId: string }) => {
      if (handleSignal.current) handleSignal.current(signal);
      else pendingSignals.current.push(signal);
    };
    socket.on('rtc:signal', onSignal);
    return () => {
      socket.off('rtc:signal', onSignal);
    };
  }, [socket]);

  // 3. A fresh peer connection for each time the two participants are both present.
  useEffect(() => {
    if (!socket || !joined || !peerPresent) return;

    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    pcRef.current = pc;
    let makingOffer = false;
    let ignoreOffer = false;
    let closed = false;

    pc.onnegotiationneeded = () => {
      void (async () => {
        try {
          makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription)
            socket.emit('rtc:signal', { description: pc.localDescription.toJSON() });
        } catch (error) {
          if (!closed) console.warn('Could not start call negotiation', error);
        } finally {
          makingOffer = false;
        }
      })();
    };
    pc.onicecandidate = ({ candidate }) => {
      const init = candidate?.toJSON();
      socket.emit('rtc:signal', {
        candidate: init
          ? {
              candidate: init.candidate ?? '',
              sdpMid: init.sdpMid,
              sdpMLineIndex: init.sdpMLineIndex,
              usernameFragment: init.usernameFragment,
            }
          : null,
      });
    };
    pc.ontrack = ({ streams, track }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      // A new object each time so the <video> element picks up added or replaced tracks.
      setRemoteStream(new MediaStream(stream.getTracks()));
      track.onended = () =>
        setRemoteStream(new MediaStream(stream.getTracks().filter((t) => t.readyState === 'live')));
    };
    pc.onconnectionstatechange = () => {
      if (closed) return;
      setConnectionState(pc.connectionState);
      // Try a fresh network path; succeeds when the outage was temporary.
      if (pc.connectionState === 'failed') pc.restartIce();
    };

    handleSignal.current = (signal) => {
      void (async () => {
        try {
          if (signal.description) {
            const description = signal.description;
            const collision =
              description.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
            ignoreOffer = !polite && collision;
            if (ignoreOffer) return;
            await pc.setRemoteDescription(description);
            if (description.type === 'offer') {
              await pc.setLocalDescription();
              if (pc.localDescription) {
                socket.emit('rtc:signal', { description: pc.localDescription.toJSON() });
              }
            }
          } else if (signal.candidate !== undefined) {
            try {
              await pc.addIceCandidate(signal.candidate ?? undefined);
            } catch (error) {
              // Candidates for an offer we chose to ignore are expected to fail.
              if (!ignoreOffer) throw error;
            }
          }
        } catch (error) {
          if (!closed) console.warn('Call signalling step failed', error);
        }
      })();
    };

    // Send whatever we have. Tracks that become available later are added by effect 4.
    const local = localRef.current;
    const screenTrack = screenRef.current?.getVideoTracks()[0];
    local?.getAudioTracks().forEach((track) => pc.addTrack(track, local));
    const cameraTrack = local?.getVideoTracks()[0];
    if (screenTrack && local) pc.addTrack(screenTrack, local);
    else if (cameraTrack && local) pc.addTrack(cameraTrack, local);
    if (!local && !screenTrack) {
      // Nothing to send: still negotiate so we can receive the other side.
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

    for (const signal of pendingSignals.current.splice(0)) handleSignal.current(signal);

    return () => {
      closed = true;
      handleSignal.current = null;
      pendingSignals.current = [];
      pc.onnegotiationneeded = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      if (pcRef.current === pc) pcRef.current = null;
      setConnectionState(null);
      setRemoteStream(null);
    };
  }, [socket, joined, polite, peerPresent, peerEpoch]);

  // 4. Local media that arrived after the connection was created.
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !localStream) return;
    const sending = new Set(pc.getSenders().map((sender) => sender.track));
    for (const track of localStream.getTracks()) {
      if (track.kind === 'video' && screenRef.current) continue;
      if (!sending.has(track)) pc.addTrack(track, localStream);
    }
  }, [localStream, peerEpoch, peerPresent, joined]);

  const screenOn = screenStream !== null;
  const status: CallStatus =
    !joined || !peerPresent
      ? 'idle'
      : connectionState === 'connected'
        ? 'connected'
        : connectionState === 'disconnected'
          ? 'reconnecting'
          : connectionState === 'failed'
            ? 'failed'
            : 'connecting';

  // 5. Tell the other side what we are sending, so their UI can say "camera off" instead of guessing.
  useEffect(() => {
    if (joined) onMediaState({ audio: audioOn, video: videoOn && !screenOn, screen: screenOn });
  }, [joined, audioOn, videoOn, screenOn, peerEpoch, onMediaState]);

  const toggleAudio = useCallback(() => {
    const tracks = localRef.current?.getAudioTracks() ?? [];
    if (tracks.length === 0) return;
    const next = !tracks[0]?.enabled;
    tracks.forEach((track) => (track.enabled = next));
    setAudioOn(next);
  }, []);

  const toggleVideo = useCallback(() => {
    const tracks = localRef.current?.getVideoTracks() ?? [];
    if (tracks.length === 0) return;
    const next = !tracks[0]?.enabled;
    tracks.forEach((track) => (track.enabled = next));
    setVideoOn(next);
  }, []);

  const stopScreen = useCallback(() => {
    const screen = screenRef.current;
    if (!screen) return;
    screen.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    setScreenStream(null);
    const pc = pcRef.current;
    const sender = pc?.getSenders().find((s) => s.track?.kind === 'video');
    const camera = localRef.current?.getVideoTracks()[0] ?? null;
    // Swapping the track keeps the same connection: no renegotiation, no dropped call.
    if (sender) void sender.replaceTrack(camera);
  }, []);

  const toggleScreen = useCallback(async () => {
    if (screenRef.current) return stopScreen();
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      if (!track) return;
      screenRef.current = screen;
      setScreenStream(screen);
      // The browser's own "Stop sharing" button ends the track.
      track.onended = stopScreen;
      const pc = pcRef.current;
      const sender = pc?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track);
      else if (pc) pc.addTrack(track, localRef.current ?? screen);
    } catch (error) {
      // Dismissing the picker is not an error worth reporting.
      if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
        setMediaError('Screen sharing could not be started.');
      }
    }
  }, [stopScreen]);

  return {
    localStream,
    previewStream: screenStream ?? localStream,
    remoteStream,
    status,
    media: { audio: audioOn, video: videoOn && !screenOn, screen: screenOn },
    mediaError,
    canShareScreen:
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    toggleAudio,
    toggleVideo,
    toggleScreen,
  };
}
