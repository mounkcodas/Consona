import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function AudioVisualizer({ audioRef, playing }) {
  const [target, setTarget] = useState(null);
  const contextRef = useRef(null);
  const analyserRef = useRef(null);
  const playingRef = useRef(playing);
  const drawRef = useRef(null);
  const frameRef = useRef(0);
  playingRef.current = playing;

  // Keep one media source alive while the user moves between app sections.
  useEffect(() => {
    const audio = audioRef.current;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!audio || !AudioContextClass) return;
    let context;
    try {
      context = new AudioContextClass();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      context.createMediaElementSource(audio).connect(analyser);
      analyser.connect(context.destination);
      contextRef.current = context;
      analyserRef.current = analyser;
    } catch { context?.close(); return; }
    return () => { context.close(); contextRef.current = null; analyserRef.current = null; };
  }, [audioRef]);

  // Reattach the same drawing surface whenever the player view is mounted.
  useEffect(() => {
    const findTarget = () => {
      const next = document.querySelector('.art-stage');
      setTarget(current => current === next ? current : next);
    };
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current, analyser = analyserRef.current;
    if (!target || !canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    const samples = new Uint8Array(analyser.frequencyBinCount);
    let width = 0, height = 0, frame = 0;
    const resize = () => {
      const rect = target.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width; height = rect.height;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(target);
    const draw = () => {
      analyser.getByteFrequencyData(samples);
      ctx.clearRect(0, 0, width, height);
      const count = 44, gap = 3, barWidth = Math.max(2, (width - gap * (count - 1)) / count);
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#0757d9'); gradient.addColorStop(0.55, '#1786ff'); gradient.addColorStop(1, '#71caff');
      ctx.fillStyle = gradient;
      for (let i = 0; i < count; i++) {
        const bin = Math.floor((i / count) ** 1.65 * samples.length);
        const barHeight = Math.max(2, samples[bin] / 255 * height * 0.94);
        const x = i * (barWidth + gap), y = height - barHeight;
        for (let sy = height - 4; sy >= y; sy -= 6) ctx.fillRect(x, sy, barWidth, 4);
      }
      if (playingRef.current) { frame = requestAnimationFrame(draw); frameRef.current = frame; }
      else { ctx.clearRect(0, 0, width, height); frameRef.current = 0; }
    };
    drawRef.current = () => { if (!frameRef.current) { frame = requestAnimationFrame(draw); frameRef.current = frame; } };
    if (playingRef.current) drawRef.current();
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(frameRef.current); observer?.disconnect(); drawRef.current = null; frameRef.current = 0; };
  }, [target]);

  useEffect(() => {
    if (playing) { contextRef.current?.resume().catch(() => {}); drawRef.current?.(); }
    else { cancelAnimationFrame(frameRef.current); frameRef.current = 0; }
  }, [playing, target]);

  return target ? createPortal(<canvas ref={canvasRef} className={`audio-visualizer ${playing ? 'playing' : ''}`} aria-label="Visualização do áudio em tempo real" role="img"/>, target) : null;
}
