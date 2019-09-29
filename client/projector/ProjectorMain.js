import React from 'react';

import { mult, forwardProjectionMatrixForPoints } from '../utils';
import Program from './Program';
import { cameraVideoConstraints } from '../constants';

function projectorSize() {
  const width = document.body.clientWidth;
  const height = document.body.clientHeight;
  return { width, height };
}

export default class ProjectorMain extends React.Component {
  componentWillMount() {
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: cameraVideoConstraints,
      })
      .then(stream => {
        this._videoCapture = new ImageCapture(stream.getVideoTracks()[0]);
      });
  }
  grabCameraImageAndProjectionData = async () => {
    let cameraImage

    try {
      cameraImage = await this._videoCapture.grabFrame();
    } catch (e) {
      this._videoCapture.track.stop()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: cameraVideoConstraints,
      })

      this._videoCapture = new ImageCapture(stream.getVideoTracks()[0]);
      cameraImage = await this._videoCapture.grabFrame();
    }

    const outputCorners = this.props.knobPoints.map(({ x, y }) => ({
      x: x * cameraImage.width,
      y: y * cameraImage.height,
    }));

    const inputSize = projectorSize();
    const inputCorners = [
      { x: 0, y: 0 },
      { x: inputSize.width - 1, y: 0 },
      { x: inputSize.width - 1, y: inputSize.height - 1 },
      { x: 0, y: inputSize.height - 1 },
    ];

    const a = forwardProjectionMatrixForPoints(outputCorners);
    const b = forwardProjectionMatrixForPoints(inputCorners).adjugate();
    const forwardProjectionData = a.multiply(b).data;
    // TODO(JP): the above might be somewhat expensive to calculate.
    // Probably worth profiling and caching if necessary.

    return { cameraImage, forwardProjectionData };
  };
  render() {
    const { width, height } = projectorSize();
    const multPoint = { x: width, y: height };

    const programmedPageByNumber = {};
    const programById = {};

    this.props.programs.forEach(program => {
      programById[program.id] = program;
    });

    this.props.pages.forEach(page => {
      if(!page.points || !page.programId) return;

      const program = programById[page.programId];

      const centerPoint = { x: 0, y: 0 };
      page.points.forEach(point => {
        centerPoint.x += point.x / 4;
        centerPoint.y += point.y / 4;
      });

      programmedPageByNumber[page.number] = {
        ...program,
        rawPoints: page.points,
        number: page.number,
        programId: page.programId,
        points: {
          topLeft: mult(page.points[0], multPoint),
          topRight: mult(page.points[1], multPoint),
          bottomRight: mult(page.points[2], multPoint),
          bottomLeft: mult(page.points[3], multPoint),
          center: mult(centerPoint, multPoint),
        },
        data: this.props.dataByPageNumber[page.number] || {},
      };
    });

    const markers = this.props.markers.map(m => ({
      ...m,
      globalCenter: mult(m.globalCenter, multPoint),
      globalPoints: m.globalPoints.map(p => mult(p, multPoint)),
      paperCenter: m.paperCenter,
      paperPoints: m.paperPoints,
    }));

    return (
      <div>
        {this.props.pages.map(page => {
          const programmedPage = programmedPageByNumber[page.number];

          return <Program
            key={`${programmedPage.number}-${programmedPage.currentCodeHash}`}
            markers={markers}
            programmedPageByNumber={programmedPageByNumber}
            page={programmedPage}
            grabCameraImageAndProjectionData={this.grabCameraImageAndProjectionData}
            width={width}
            height={height}
            paperRatio={this.props.paperRatio}
            onDataChange={(data, callback) => {
              this.props.onDataByPageNumberChange(
                {
                  ...this.props.dataByPageNumber,
                  [programmedPage.number]: {
                    ...this.props.dataByPageNumber[programmedPage.number],
                    ...data,
                  },
                },
                callback
              );
            }}
          />
        })}
      </div>
    );
  }
}
