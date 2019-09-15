import React from 'react';

import { add } from '../utils';
import styles from './DebugPage.css';

export default class CameraMain extends React.Component {
  constructor(props) {
    super(props);

    const videoRatio = this.props.videoWidth / this.props.videoHeight;
    const bl = props.page.points[3];
    const br = props.page.points[2];
    bl.y *= videoRatio;
    br.y *= videoRatio;

    this.state = {
      page: props.page,
      grabbed: false,
      grabbedOffset: { x: 0, y: 0 },
      resizing: false,
    };
  }

  _onMouseEnter = () => {
    this.props.onMouseEnter();
  };

  _onMouseLeave = () => {
    if (this.state.grabbed) return;
    if (this.state.resizing) return;

    this.props.onRelease();
  };

  _onMouseDown = event => {
    if (event.target === this._closeEl) {
      this.props.remove();
      return;
    }
    const rect = this._el.getBoundingClientRect();
    const x = event.clientX - rect.x;
    const y = event.clientY - rect.y;

    const resizing = event.target === this._handleEl;
    const grabbed = !resizing;

    this.setState({ grabbed, resizing, grabbedOffset: { x, y } });
    document.addEventListener('mouseup', this._onMouseUp, false);
    document.addEventListener('mousemove', this._onMouseMove, false);
  };

  _onMouseUp = () => {
    this.setState({ grabbed: false, resizing: false });
    document.removeEventListener('mouseup', this._onMouseUp, false);
    document.removeEventListener('mousemove', this._onMouseMove, false);
  };

  _onMouseMove = event => {
    const rect = this._el.getBoundingClientRect();
    const parentRect = this._el.parentElement.getBoundingClientRect();
    const page = this.state.page;
    if (this.state.grabbed) {
      const x = event.clientX - rect.x - this.state.grabbedOffset.x;
      const y = event.clientY - rect.y - this.state.grabbedOffset.y;

      const normx = x / parentRect.width;
      const normy = y / parentRect.height;
      page.points = page.points.map(point => add(point, { x: normx, y: normy }));
    }

    if (this.state.resizing) {
      const tr = page.points[1];
      const br = page.points[2];
      const bl = page.points[3];

      const x = event.clientX - parentRect.x;
      const y = event.clientY - parentRect.y;

      const normx = x / parentRect.width;
      const normy = y / parentRect.height;
      tr.x = normx;
      br.x = normx;
      br.y = normy;
      bl.y = normy;
    }

    this.setState({ page });
  };

  render() {
    const tl = this.state.page.points[0];
    const br = this.state.page.points[2];
    const width = br.x - tl.x;
    const height = br.y - tl.y;

    return (
      <div
        ref={el => (this._el = el)}
        onMouseDown={this._onMouseDown}
        onMouseEnter={this._onMouseEnter}
        onMouseLeave={this._onMouseLeave}
        onDrag={this._onDrag}
        className={styles.page}
        style={{
          position: 'absolute',
          left: `${tl.x * 100}%`,
          top: `${tl.y * 100}%`,
          width: `${width * 100}%`,
          height: `${height * 100}%`,
        }}
      >
        <h3>Page #{this.state.page.number}</h3>

        <div ref={el => (this._handleEl = el)} className={styles.resizeHandle} />

        <div ref={el => (this._closeEl = el)} className={styles.closeButton} />
      </div>
    );
  }
}
