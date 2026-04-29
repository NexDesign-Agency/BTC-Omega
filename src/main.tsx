import React, { StrictMode, Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", color: "#ff4466", backgroundColor: "#05070a", minHeight: "100vh", fontFamily: "monospace" }}>
          <h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>Runtime Crash!</h1>
          <p style={{ marginBottom: "1rem", color: "#fff" }}>An error occurred during rendering.</p>
          <pre style={{ backgroundColor: "rgba(255,0,0,0.1)", padding: "1rem", borderRadius: "8px", overflowX: "auto" }}>
            {this.state.error?.toString()}
          </pre>
          <pre style={{ marginTop: "1rem", backgroundColor: "rgba(255,255,255,0.05)", color: "#aaa", padding: "1rem", borderRadius: "8px", overflowX: "auto" }}>
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
