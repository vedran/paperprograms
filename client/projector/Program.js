import React from 'react';
import randomColor from 'randomcolor';
import sortBy from 'lodash/sortBy';
import throttle from 'lodash/throttle';
import xhr from 'xhr';

import { forwardProjectionMatrixForPoints, mult } from '../utils';
import styles from './Program.css';

function matrixToCssTransform(matrix) {
  // prettier-ignore
  const values = [
    matrix.get(0, 0), matrix.get(1, 0), 0, matrix.get(2, 0),
    matrix.get(0, 1), matrix.get(1, 1), 0, matrix.get(2, 1),
    0, 0, 1, 0,
    matrix.get(0, 2), matrix.get(1, 2), 0, matrix.get(2, 2),
  ];
  return `matrix3d(${values.join(',')})`;
}

const canvasSizeMatrixes = [];
function getCanvasSizeMatrix(width, height) {
  const key = `${width},${height}`;
  canvasSizeMatrixes[key] =
    canvasSizeMatrixes[key] ||
    forwardProjectionMatrixForPoints([
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ]).adjugate();
  return canvasSizeMatrixes[key];
}

const defaultCanvasWidth = 100;
const iframeWidth = 400;
const maxLogLength = 100;

export default class Program extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      canvasSizeByPageNumber: {},
      showSupporterCanvasById: {},
      iframe: null,
      paperRatio: this.props.paperRatio,
      debugData: { logs: [] },
    };
  }

  componentDidMount() {
    this._worker = new Worker(this.props.page.currentCodeUrl)
    this._worker.onmessage = this._receiveMessage;
    this._worker.onerror = this._receiveError;
    this._updateDebugData();
  }

  componentWillUnmount() {
    this._worker.terminate();
  }

  _receiveMessage = event => {
    const { command, sendData, messageId } = event.data;

    if (command === 'get') {
      if (sendData.name === 'number') {
        this._worker.postMessage({
          messageId,
          receiveData: { object: this.props.page.number.toString() },
        });
      } else if (sendData.name === 'canvas') {
        const pageNumber = sendData.data.number || this.props.page.number;

        if (this.state.canvasSizeByPageNumber[pageNumber]) {
          this._worker.postMessage({ messageId, receiveData: { object: null } });
        } else {
          this[`_canvasAvailableCallback_${pageNumber}`] = canvas => {
            const offscreen = canvas.transferControlToOffscreen();
            this._worker.postMessage({ messageId, receiveData: { object: offscreen } }, [
              offscreen,
            ]);
            delete this[`_canvasAvailableCallback_${pageNumber}`];
          };
          this.setState({
            canvasSizeByPageNumber: {
              ...this.state.canvasSizeByPageNumber,
              [pageNumber]: {
                width: sendData.data.width || defaultCanvasWidth,
                height:
                  sendData.data.height ||
                  (sendData.data.width ? sendData.data.width : defaultCanvasWidth) *
                    this.state.paperRatio,
              },
            },
          });
        }
      } else if (sendData.name === 'supporterCanvas') {
        const supporterCanvasId = sendData.data.id || 'default';

        if (this.state.showSupporterCanvasById[supporterCanvasId]) {
          this._worker.postMessage({ messageId, receiveData: { object: null } });
        } else {
          this[`_supporterCanvasAvailableCallback_${supporterCanvasId}`] = canvas => {
            const offscreen = canvas.transferControlToOffscreen();
            this._worker.postMessage({ messageId, receiveData: { object: offscreen } }, [
              offscreen,
            ]);
            delete this[`_supporterCanvasAvailableCallback_${supporterCanvasId}`];
          };
          this.setState({
            showSupporterCanvasById: {
              ...this.state.showSupporterCanvasById,
              [supporterCanvasId]: true,
            },
          });
        }
      } else if (sendData.name === 'papers') {
        this._worker.postMessage({ messageId, receiveData: { object: this.props.programmedPageByNumber } });
      } else if (sendData.name === 'markers') {
        this._worker.postMessage({ messageId, receiveData: { object: this.props.markers } });
      } else if (sendData.name === 'camera') {
        this.props.grabCameraImageAndProjectionData().then(object => {
          this._worker.postMessage(
            {
              messageId,
              receiveData: { object },
            },
            [object.cameraImage]
          );
        }).catch(e => {
        });
      }
    } else if (command === 'set') {
      if (sendData.name === 'data') {
        this.props.onDataChange(sendData.data, () => {
          this._worker.postMessage({ messageId });
        });
      } else if (sendData.name === 'volume') {
        this.props.onGlobalVolumeChange(Math.max(Math.min(1, sendData.data), 0), () => {
          this._worker.postMessage({ messageId });
        })
      } else if (sendData.name === 'iframe') {
        this.setState({ iframe: sendData.data });
      }
    } else if (command === 'flushLogs') {
      this._addLogs(sendData);
    }
  };

  _receiveError = error => {
    const logData = {
      name: 'Error',
      args: [error.message],
      lineNumber: error.lineno,
      columnNumber: error.colno,
      filename: error.filename,
      timestamp: Date.now(),
    };
    if (logData.filename.match(/\/program\..*/)) logData.filename = 'program';
    this._addLogs([logData]);
  };

  _addLogs = newLogs => {
    const logs = sortBy(this.state.debugData.logs.concat(newLogs), 'timestamp').slice(
      -maxLogLength
    );
    this.setState({ debugData: { ...this.state.debugData, logs } }, () => {
      this._updateDebugData();
    });
  };

  _updateDebugData = throttle(() => {
    xhr.put(this.props.page.debugUrl, { json: this.state.debugData }, () => {});
  }, 300);

  _getCssTransform = (page, width, height) => {
    return matrixToCssTransform(
      forwardProjectionMatrixForPoints(
        page.rawPoints.map(point => mult(point, { x: this.props.width, y: this.props.height }))
      ).multiply(getCanvasSizeMatrix(width, height))
    );
  };

  render() {
    const page = this.props.page;

    return (
      <div>
        <div
          className={
            !page.editorInfo.claimed && page.codeHasChanged
              ? styles.canvasWithChangedCode
              : ''
          }
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 200,
            height: 200,
            transform: this._getCssTransform(this.props.page, 200, 200),
            transformOrigin: '0 0 0',
            zIndex: 3,
            boxShadow: page.editorInfo.claimed
              ? `0 0 0 1px ${randomColor({
                seed: page.editorInfo.editorId,
              })} inset`
              : '',
          }}
        />
        {Object.keys(this.state.canvasSizeByPageNumber).map(pageNumberString => {
          const { width, height } = this.state.canvasSizeByPageNumber[pageNumberString];
          const pageNumber = parseInt(pageNumberString, 10);

          return (
            <canvas
              key={`canvas_${pageNumberString}`}
              ref={el => {
                if (el && this[`_canvasAvailableCallback_${pageNumber}`]) {
                  this[`_canvasAvailableCallback_${pageNumber}`](el);
                }
              }}
              width={width}
              height={height}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width,
                height,
                transform: this._getCssTransform(
                  this.props.page,
                  width,
                  height
                ),
                transformOrigin: '0 0 0',
                zIndex: pageNumber == page.number ? 1 : 2,
              }}
            />
          );
        })}
        {this.state.iframe && this.renderIframe()}
        {Object.keys(this.state.showSupporterCanvasById).map(supporterCanvasId => (
          <canvas
            key={`supporterCanvas_${supporterCanvasId}`}
            ref={el => {
              if (el && this[`_supporterCanvasAvailableCallback_${supporterCanvasId}`]) {
                this[`_supporterCanvasAvailableCallback_${supporterCanvasId}`](el);
              }
            }}
            width={this.props.width}
            height={this.props.height}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: this.props.width,
              height: this.props.height,
              zIndex: 2,
            }}
          />
        ))}
      </div>
    );
  }

  renderIframe() {
    const iframeHeight = iframeWidth * this.state.paperRatio;
    const iframeStyle = {
      position: 'absolute',
      left: 0,
      top: 0,
      width: iframeWidth,
      height: iframeHeight,
      transform: this._getCssTransform(this.props.page, iframeWidth, iframeHeight),
      transformOrigin: '0 0 0',
      zIndex: 1,
    };

    return <iframe key="iframe" src={this.state.iframe.src} style={{ ...iframeStyle }} />;
  }
}
