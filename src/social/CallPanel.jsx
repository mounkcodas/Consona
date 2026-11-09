import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { Avatar } from './ChatPane.jsx';

export function useCalls(social) {
  const [call, setCall] = useState(null), [localStream, setLocalStream] = useState(null), [remoteStream, setRemoteStream] = useState(null);
  const current = useRef(null), peer = useRef(null), local = useRef(null), queuedIce = useRef([]), queue = useRef(Promise.resolve()), timer = useRef(null);
  const set = value => { current.current = value; setCall(value); };
  const signal = value => { const c = current.current; if (c) social.sendEvent({ type: 'call_signal', peerId: c.peerId, callId: c.id, signal: value }); };
  function end(send = true) {
    if (send) signal({ type: 'hangup' });
    clearTimeout(timer.current); peer.current?.close(); peer.current = null;
    local.current?.getTracks().forEach(track => track.stop()); local.current = null;
    setLocalStream(null); setRemoteStream(null); queuedIce.current = []; set(null);
  }
  async function prepare(video) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não oferece chamadas por áudio e vídeo.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    if (!current.current) { stream.getTracks().forEach(t => t.stop()); return; }
    local.current = stream; setLocalStream(stream);
    const { iceServers } = await social.request('/call/config');
    if (!current.current) { stream.getTracks().forEach(t => t.stop()); return; }
    const pc = new RTCPeerConnection({ iceServers }); peer.current = pc;
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    pc.onicecandidate = event => { if (event.candidate) signal({ type: 'ice', candidate: event.candidate.toJSON() }); };
    pc.ontrack = event => setRemoteStream(event.streams[0] || new MediaStream([event.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') { clearTimeout(timer.current); if (current.current) set({ ...current.current, status: 'connected' }); }
      if (pc.connectionState === 'failed') { social.fail(new Error('Não foi possível conectar a chamada nesta rede.')); end(); }
    };
    return pc;
  }
  async function start(friend, video) {
    if (current.current) return social.fail(new Error('Encerre a chamada atual primeiro.'));
    try {
      if (social.state.settings.call_invites !== 'friends') await social.updateSettings({ call_invites: 'friends' });
      const { callId } = await social.request('/call', 'POST', { userId: friend.id, video });
      set({ id: callId, peerId: friend.id, friend, video, outgoing: true, status: 'ringing' });
      timer.current = setTimeout(() => { social.fail(new Error('A chamada não foi atendida.')); end(); }, 60000);
    } catch (error) { social.fail(error); end(); }
  }
  async function accept() {
    try { set({ ...current.current, status: 'connecting' }); await prepare(current.current.video); signal({ type: 'accept' }); }
    catch (error) { social.fail(error); end(); }
  }
  async function handle(event) {
    const value = event.signal;
    if (value.type === 'invite') {
      if (current.current) { social.sendEvent({ type: 'call_signal', peerId: event.actorId, callId: event.callId, signal: { type: 'hangup' } }); return; }
      const friend = social.state.friends.find(f => f.id === event.actorId); if (!friend) return;
      set({ id: event.callId, peerId: event.actorId, friend, video: value.video, outgoing: false, status: 'ringing' });
      timer.current = setTimeout(() => end(), 60000); return;
    }
    if (!current.current || current.current.id !== event.callId || current.current.peerId !== event.actorId) return;
    if (value.type === 'hangup') return end(false);
    if (value.type === 'accept' && current.current.outgoing && current.current.status === 'ringing') {
      set({ ...current.current, status: 'connecting' });
      const pc = await prepare(current.current.video); if (!pc) return;
      await pc.setLocalDescription(await pc.createOffer()); signal({ type: 'offer', sdp: pc.localDescription }); return;
    }
    const pc = peer.current;
    if (value.type === 'ice') { if (pc?.remoteDescription) await pc.addIceCandidate(value.candidate); else queuedIce.current.push(value.candidate); return; }
    if (!pc) return;
    if (value.type === 'offer' && !current.current.outgoing) { await pc.setRemoteDescription(value.sdp); await pc.setLocalDescription(await pc.createAnswer()); signal({ type: 'answer', sdp: pc.localDescription }); }
    if (value.type === 'answer' && current.current.outgoing) await pc.setRemoteDescription(value.sdp);
    if (pc.remoteDescription) { for (const ice of queuedIce.current.splice(0)) await pc.addIceCandidate(ice); }
  }
  useEffect(() => {
    if (!social.callEvent.length) return;
    const events = social.callEvent; social.clearCallEvent();
    for (const event of events) queue.current = queue.current.then(() => handle(event)).catch(error => { social.fail(error); end(); });
  }, [social.callEvent]);
  useEffect(() => { if (current.current && (!social.state.friends.some(f => f.id === current.current.peerId) || social.state.settings.call_invites === 'none' || social.connection === 'offline')) end(); }, [social.state.friends, social.state.settings.call_invites, social.connection]);
  useEffect(() => () => end(), []);
  return { call, localStream, remoteStream, start, accept, end };
}
export default function CallPanel({ calls }) {
  const localVideo = useRef(null), remoteVideo = useRef(null), [muted, setMuted] = useState(false), [cameraOff, setCameraOff] = useState(false);
  useEffect(() => { setMuted(false); setCameraOff(false); }, [calls.call?.id]);
  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = calls.localStream; }, [calls.localStream, calls.call]);
  useEffect(() => { if (remoteVideo.current) remoteVideo.current.srcObject = calls.remoteStream; }, [calls.remoteStream, calls.call]);
  if (!calls.call) return null;
  const { call } = calls;
  return <section className="social-call social-surface" role="dialog" aria-label="Chamada no Consona">
    <header className="social-gloss"><Phone size={18}/>Chamada {call.video ? 'de vídeo' : 'de voz'}</header>
    <Avatar person={call.friend} size="large"/><h3>{call.friend.displayName}</h3><p>{call.status === 'connected' ? 'Conectado' : call.status === 'connecting' ? 'Conectando...' : call.outgoing ? 'Chamando...' : 'Quer conversar com você'}</p>
    <video ref={remoteVideo} autoPlay playsInline className={call.video ? '' : 'social-audio-only'}/>
    <video ref={localVideo} autoPlay playsInline muted className={call.video ? 'social-local-video' : 'social-audio-only'}/>
    <div className="social-call-controls">{!call.outgoing && call.status === 'ringing' && <button onClick={calls.accept}><Phone size={18}/>Atender</button>}
      {calls.localStream && <><button aria-label={muted ? 'Ativar microfone' : 'Silenciar microfone'} onClick={() => { calls.localStream.getAudioTracks().forEach(t => { t.enabled = muted; }); setMuted(!muted); }}>{muted ? <MicOff size={18}/> : <Mic size={18}/>}</button>{call.video && <button aria-label={cameraOff ? 'Ativar câmera' : 'Desativar câmera'} onClick={() => { calls.localStream.getVideoTracks().forEach(t => { t.enabled = cameraOff; }); setCameraOff(!cameraOff); }}>{cameraOff ? <VideoOff size={18}/> : <Video size={18}/>}</button>}</>}
      <button className="social-danger" onClick={() => calls.end()}><PhoneOff size={18}/>{call.status === 'ringing' && !call.outgoing ? 'Recusar' : 'Encerrar'}</button>
    </div>
  </section>;
}
