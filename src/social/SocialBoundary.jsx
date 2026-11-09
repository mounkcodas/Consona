import React from 'react';
// A social UI failure must never unmount the existing audio player.
export default class SocialBoundary extends React.Component {
  state = { failed: false, generation: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('Consona social interface:', error.message); }
  render() {
    if (this.state.failed) return <div className="social-root"><div className="social-error" role="alert"><span>Não foi possível abrir os amigos. Sua música continua disponível.</span><button onClick={() => this.setState(s => ({ failed:false,generation:s.generation+1 }))}>Reconectar</button></div></div>;
    return <React.Fragment key={this.state.generation}>{this.props.children}</React.Fragment>;
  }
}
