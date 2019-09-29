/* global cv */

import colorDiff from 'color-diff';
import sortBy from 'lodash/sortBy';

import {
  add,
  clamp,
  cross,
  diff,
  div,
  forwardProjectionMatrixForPoints,
  mult,
  norm,
  projectPoint,
  shrinkPoints,
} from '../utils';
import { code8400 } from '../dotCodes';
import { colorNames, cornerNames } from '../constants';
import simpleBlobDetector from './simpleBlobDetector';

function keyPointToAvgColor(keyPoint, videoMat) {
  const x = Math.floor(keyPoint.pt.x - keyPoint.size / 2);
  const y = Math.floor(keyPoint.pt.y - keyPoint.size / 2);

  const circleROI = videoMat.roi({
    x,
    y,
    width: keyPoint.size,
    height: keyPoint.size,
  });

  const circleMask = cv.Mat.zeros(keyPoint.size, keyPoint.size, cv.CV_8UC1);
  cv.circle(
    circleMask,
    { x: Math.floor(keyPoint.size / 2), y: Math.floor(keyPoint.size / 2) },
    keyPoint.size / 2 - 1,
    [255, 255, 255, 0],
    -1
  );

  const circleMean = cv.mean(circleROI, circleMask);
  circleROI.delete();
  circleMask.delete();

  // Find the corners of the circle ROI, but just one pixel outside of it to be
  // more sure to capture white pixels.
  const corners = [
    videoMat.ptr(clamp(y - 1, 0, videoMat.rows), clamp(x - 1, 0, videoMat.cols)),
    videoMat.ptr(clamp(y - 1, 0, videoMat.rows), clamp(x + keyPoint.size + 1, 0, videoMat.cols)),
    videoMat.ptr(clamp(y + keyPoint.size + 1, 0, videoMat.rows), clamp(x - 1, 0, videoMat.cols)),
    videoMat.ptr(
      clamp(y + keyPoint.size + 1, 0, videoMat.rows),
      clamp(x + keyPoint.size + 1, 0, videoMat.cols)
    ),
  ];

  const whiteMax = [
    Math.max(1, Math.max(corners[0][0], corners[1][0], corners[2][0], corners[3][0])),
    Math.max(1, Math.max(corners[0][1], corners[1][1], corners[2][1], corners[3][1])),
    Math.max(1, Math.max(corners[0][2], corners[1][2], corners[2][2], corners[3][2])),
    255,
  ];

  // Normalize to the white colour.
  return [
    clamp(circleMean[0] / whiteMax[0] * 255, 0, 255),
    clamp(circleMean[1] / whiteMax[1] * 255, 0, 255),
    clamp(circleMean[2] / whiteMax[2] * 255, 0, 255),
    255,
  ];
}

function colorToRGB(c) {
  return { R: Math.round(c[0]), G: Math.round(c[1]), B: Math.round(c[2]) };
}

function colorIndexForColor(matchColor, colors) {
  const colorsRGB = colors.map(colorToRGB);
  return colorsRGB.indexOf(colorDiff.closest(colorToRGB(matchColor), colorsRGB));
}

function shapeToId(colorIndexes) {
  return code8400.indexOf(colorIndexes.join('')) % (code8400.length / 4);
}

function shapeToCornerNum(colorIndexes) {
  return Math.floor(code8400.indexOf(colorIndexes.join('')) / (code8400.length / 4));
}

function knobPointsToROI(knobPoints, videoMat) {
  const clampedKnobPoints = knobPoints.map(point => ({
    x: clamp(point.x, 0, 1),
    y: clamp(point.y, 0, 1),
  }));
  const minX = Math.min(...clampedKnobPoints.map(point => point.x * videoMat.cols));
  const minY = Math.min(...clampedKnobPoints.map(point => point.y * videoMat.rows));
  const maxX = Math.max(...clampedKnobPoints.map(point => point.x * videoMat.cols));
  const maxY = Math.max(...clampedKnobPoints.map(point => point.y * videoMat.rows));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

let projectPointToUnitSquarePreviousKnobPoints;
let projectPointToUnitSquarePreviousMatrix;
function projectPointToUnitSquare(point, videoMat, knobPoints) {
  if (
    !projectPointToUnitSquarePreviousMatrix ||
    projectPointToUnitSquarePreviousKnobPoints !== knobPoints
  ) {
    projectPointToUnitSquarePreviousKnobPoints = knobPoints;
    projectPointToUnitSquarePreviousMatrix = forwardProjectionMatrixForPoints(
      knobPoints
    ).adjugate();
  }
  return projectPoint(
    div(point, { x: videoMat.cols, y: videoMat.rows }),
    projectPointToUnitSquarePreviousMatrix
  );
}

// Depth-first search until a streak of `lengthLeft` has been found.
// Should be initialised with at least one item in `shapeToFill`.
function findShape(shapeToFill, neighborIndexes, lengthLeft) {
  if (lengthLeft === 0) return true;

  const lastIndex = shapeToFill[shapeToFill.length - 1];
  for (const index of neighborIndexes[lastIndex]) {
    if (shapeToFill.includes(index)) continue;
    shapeToFill.push(index);
    if (findShape(shapeToFill, neighborIndexes, lengthLeft - 1)) return true;
    shapeToFill.pop();
  }

  return false;
}

function colorIndexesForShape(shape, keyPoints, videoMat, colorsRGB) {
  const shapeColors = shape.map(
    keyPointIndex => keyPointToAvgColor(keyPoints[keyPointIndex], videoMat),
    colorsRGB
  );

  const closestColors = [];
  const remainingShapeColors = shapeColors.slice();
  colorsRGB.forEach(mainColor => {
    const closestColorIndex = colorIndexForColor(mainColor, remainingShapeColors);
    closestColors.push(remainingShapeColors[closestColorIndex]);
    remainingShapeColors.splice(closestColorIndex, 1);
  });

  return shapeColors.map(color => colorIndexForColor(color, closestColors));
}



// Old way to process corners. Relies on a dot that has only one neighbor
const processCornersFromTerminalPoint = (keyPoints, neighborIndexes, displayMat, videoMat, config) => {
  // Find acyclical shapes of 7, and put ids into `newDataToRemember`.
  const seenIndexes = new window.Set();
  const keyPointSizes = [];
  const pointsById = {};
  const directionVectorsById = {};
  for (let i = 0; i < keyPoints.length; i++) {
    if (neighborIndexes[i].length == 1 && !seenIndexes.has(i)) {
      const shape = [i]; // Initialise with the first index, then run findShape with 7-1.
      if (findShape(shape, neighborIndexes, 7 - 1)) {
        shape.forEach(index => seenIndexes.add(index));

        // Reverse the array if it's the wrong way around.
        const mag = cross(
          diff(keyPoints[shape[0]].pt, keyPoints[shape[3]].pt),
          diff(keyPoints[shape[6]].pt, keyPoints[shape[3]].pt)
        );
        if (mag > 100) {
          // Use 100 to avoid straight line. We already depend on sorting by x for that.
          shape.reverse();
        }

        const colorIndexes = colorIndexesForShape(shape, keyPoints, videoMat, config.colorsRGB);
        const id = shapeToId(colorIndexes);
        const cornerNum = shapeToCornerNum(colorIndexes);

        if (cornerNum > -1) {
          // Store the colorIndexes so we can render them later for debugging.
          colorIndexes.forEach((colorIndex, shapePointIndex) => {
            keyPoints[shape[shapePointIndex]].colorIndex = colorIndex;
          });

          pointsById[id] = pointsById[id] || [];
          pointsById[id][cornerNum] = keyPoints[shape[3]].pt;
          directionVectorsById[id] = directionVectorsById[id] || [];
          directionVectorsById[id][cornerNum] = diff(
            keyPoints[shape[6]].pt,
            keyPoints[shape[3]].pt
          );

          shape.forEach(index => keyPointSizes.push(keyPoints[index].size));

          if (displayMat && config.showOverlayShapeId) {
            // Draw id and corner name.
            cv.putText(
              displayMat,
              `${id},${cornerNames[cornerNum]}`,
              div(add(keyPoints[shape[0]].pt, keyPoints[shape[6]].pt), { x: 2, y: 2 }),
              cv.FONT_HERSHEY_DUPLEX,
              0.5,
              [0, 0, 255, 255]
            );
          }
        }
      }
    }
  }

  return { pointsById, directionVectorsById, keyPointSizes }
}


// New way to process corners. Relies on 90 degree angle between corner and neighboring dots
const processCornersFromRightAngles = (keyPoints, neighborIndexes, displayMat, videoMat, config) => {
  /* Goal:
    1. Find each point that has at least 2 neighbours
    2. Find two baseline neighbours that form a 90 degree angle with the corner
    3. For each baseline, find the next neighbour that forms a straight line
  */

  const getNodeAngle = (corner, baseline, node) => {
    const d1 = diff(corner.pt, baseline.pt);
    const d2 = diff(corner.pt, node.pt);

    const a1 = Math.atan2(d1.y, d1.x);
    const a2 = Math.atan2(d2.y, d2.x);

    const sign = a1 > a2 ? 1 : -1;
    const angle = a1 - a2;
    const K = -sign * Math.PI * 2;

    return Math.abs(Math.abs(K + angle) < Math.abs(angle) ? K + angle : angle);
  }

  const getParallelNeighbors = (corner, baselineIndex, neighbors) => {
    const filtered = neighbors.filter(n => getNodeAngle(corner, keyPoints[baselineIndex], keyPoints[n]) < 0.2)
    filtered.sort(
      (a, b) =>
        getNodeAngle(corner, keyPoints[baselineIndex], keyPoints[a]) -
        getNodeAngle(corner, keyPoints[baselineIndex], keyPoints[b])
    );

    return filtered
  }

  const dfsParallelNeighbours = (corner, baselineIndex, neighbors, seen, remaining) => {
    const validNeighbors = getParallelNeighbors(corner, baselineIndex, neighbors);

    for (let i = 0; i < validNeighbors.length; i++) {
      if (seen[validNeighbors[i]]) {
        continue;
      }

      seen[validNeighbors[i]] = true;

      if (remaining === 1) {
        return [validNeighbors[i]]
      }

      const found = dfsParallelNeighbours(corner, baselineIndex, neighborIndexes[validNeighbors[i]], seen, remaining - 1)
      if (found.length) {
        return found.concat(validNeighbors[i])
      }

      seen[validNeighbors[i]] = false;
    }

    return []
  }

  const used = {}
  const paths = []

  for (let i = 0; i < keyPoints.length; i++) {
    if (neighborIndexes[i].length < 2) continue;
    if (used[i]) continue;

    const corner = keyPoints[i];

    for (let j = 0; j < neighborIndexes[i].length - 1; j++) {
      for (let k = j + 1; k < neighborIndexes[i].length; k++) {
        const n1Index = neighborIndexes[i][j];
        const n2Index = neighborIndexes[i][k];

        if (used[n1Index]) continue;
        if (used[n2Index]) continue;

        const n1 = keyPoints[n1Index];
        const n2 = keyPoints[n2Index];

        let angle = getNodeAngle(corner, n1, n2);
        const angleDiff = Math.abs(angle - Math.PI / 2) / (Math.PI / 2);

        let seen = JSON.parse(JSON.stringify(used));
        if (angleDiff > 0.10) {
          continue;
        }

        seen[i] = true;
        seen[n1Index] = true;
        seen[n2Index] = true;

        let directionOnePath = [
          ...dfsParallelNeighbours(corner, n1Index, neighborIndexes[n1Index], seen, 2),
          n1Index,
        ];

        let directionTwoPath = [
          n2Index,
          ...dfsParallelNeighbours(corner, n2Index, neighborIndexes[n2Index], seen, 2)
        ];

        if (directionOnePath.length + directionTwoPath.length === 6) {
          const byDist = (a, b) => {
            const distA = Math.sqrt(
              Math.pow(keyPoints[i].pt.x - keyPoints[a].pt.x, 2) +
              Math.pow(keyPoints[i].pt.y - keyPoints[a].pt.y, 2)
            )

            const distB = Math.sqrt(
              Math.pow(keyPoints[i].pt.x - keyPoints[b].pt.x, 2) +
              Math.pow(keyPoints[i].pt.y - keyPoints[b].pt.y, 2)
            )

            return distB - distA;
          }


          directionOnePath.sort(byDist);
          directionTwoPath.sort(byDist);
          directionTwoPath = directionTwoPath.reverse();

          const path = [...directionOnePath, i, ...directionTwoPath]
          paths.push(path);

          for (let m = 0; m < path.length; m++) {
            used[path[m]] = true;
          }
        }
      }
    }
  }

  const keyPointSizes = [];
  const pointsById = {};
  const directionVectorsById = {};

  paths.map(path => {
    // Reverse the array if it's the wrong way around.
    const mag = cross(
      diff(keyPoints[path[0]].pt, keyPoints[path[3]].pt),
      diff(keyPoints[path[6]].pt, keyPoints[path[3]].pt)
    );
    if (mag > 100) {
      // Use 100 to avoid straight line. We already depend on sorting by x for that.
      path.reverse();
    }

    const colorIndexes = colorIndexesForShape(path, keyPoints, videoMat, config.colorsRGB);
    const id = shapeToId(colorIndexes);
    const cornerNum = shapeToCornerNum(colorIndexes);

    if (cornerNum > -1) {
      // Store the colorIndexes so we can render them later for debugging.
      colorIndexes.forEach((colorIndex, shapePointIndex) => {
        keyPoints[path[shapePointIndex]].colorIndex = colorIndex;
      });

      pointsById[id] = pointsById[id] || [];
      pointsById[id][cornerNum] = keyPoints[path[3]].pt;
      directionVectorsById[id] = directionVectorsById[id] || [];
      directionVectorsById[id][cornerNum] = diff(
        keyPoints[path[6]].pt,
        keyPoints[path[3]].pt
      );

      path.forEach(index => keyPointSizes.push(keyPoints[index].size));

      if (displayMat && config.showOverlayShapeId) {
        // Draw id and corner name.
        cv.putText(
          displayMat,
          `${id},${cornerNames[cornerNum]}`,
          div(add(keyPoints[path[0]].pt, keyPoints[path[6]].pt), { x: 2, y: 2 }),
          cv.FONT_HERSHEY_DUPLEX,
          0.5,
          [0, 0, 255, 255]
        );
      }
    }
  });

  return { pointsById, directionVectorsById, keyPointSizes }
};

export default function detectPages({
  config,
  videoCapture,
  dataToRemember,
  displayMat,
  scaleFactor,
  allBlobsAreKeyPoints,
  debugPages = [],
}) {
  const startTime = Date.now();
  const paperDotSizes = config.paperDotSizes;
    Math.max(1, Math.max.apply(null, paperDotSizes) - Math.min.apply(null, paperDotSizes)) * 2;
  const avgPaperDotSize = paperDotSizes.reduce((sum, value) => sum + value) / paperDotSizes.length;

  const videoMat = new cv.Mat(videoCapture.video.height, videoCapture.video.width, cv.CV_8UC4);
  videoCapture.read(videoMat);

  const knobPointMatrix = forwardProjectionMatrixForPoints(config.knobPoints);
  const mapToKnobPointMatrix = point => {
    return mult(projectPoint(point, knobPointMatrix), { x: videoMat.cols, y: videoMat.rows })
  };

  if (displayMat) {
    videoMat.copyTo(displayMat);
    const knobPoints = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map(mapToKnobPointMatrix);

    for (let i = 0; i < 4; i++) {
      cv.line(displayMat, knobPoints[i], knobPoints[(i + 1) % 4], [255, 0, 0, 255]);
    }
  }

  const videoROI = knobPointsToROI(config.knobPoints, videoMat);
  const clippedVideoMat = videoMat.roi(videoROI);

  let allPoints = simpleBlobDetector(clippedVideoMat, {
    filterByCircularity: true,
    minCircularity: 0.9,
    minArea: 10,
    filterByInertia: false,
    faster: true,
    scaleFactor,
  });

  allPoints.forEach(keyPoint => {
    keyPoint.matchedShape = false; // is true if point has been recognised as part of a shape
    keyPoint.pt.x += videoROI.x;
    keyPoint.pt.y += videoROI.y;

    // Give each `keyPoint` an `avgColor` and `colorIndex`.
    keyPoint.avgColor = keyPointToAvgColor(keyPoint, videoMat);
    keyPoint.colorIndex =
      keyPoint.colorIndex || colorIndexForColor(keyPoint.avgColor, config.colorsRGB);
  });

  let keyPoints = allPoints

  // Sort by x position. We rely on this when scanning through the circles
  // to find connected components, and when calibrating.
  keyPoints = sortBy(keyPoints, keyPoint => keyPoint.pt.x);

  // Build connected components by scanning through the `keyPoints`, which
  // are sorted by x-position.
  const neighborIndexes = [];
  for (let i = 0; i < keyPoints.length; i++) {
    neighborIndexes[i] = neighborIndexes[i] || [];
    for (let j = i + 1; j < keyPoints.length; j++) {
      neighborIndexes[j] = neighborIndexes[j] || [];

      // Break early if we are too far on the right anyway.
      if (keyPoints[j].pt.x - keyPoints[i].pt.x > keyPoints[i].size * 3) break;

      if (
        norm(diff(keyPoints[i].pt, keyPoints[j].pt)) <
        (keyPoints[i].size + keyPoints[j].size) * 0.9
      ) {
        neighborIndexes[i].push(j);
        neighborIndexes[j].push(i);

        if (displayMat && config.showOverlayComponentLines) {
          // Draw lines between components.
          cv.line(displayMat, keyPoints[i].pt, keyPoints[j].pt, [0, 0, 255, 255], 2);
        }
      }
    }
  }

  const {
    directionVectorsById,
    pointsById,
    keyPointSizes,
  } = processCornersFromRightAngles(keyPoints, neighborIndexes, displayMat, videoMat, config)

  const avgKeyPointSize =
    keyPointSizes.reduce((sum, value) => sum + value, 0) / keyPointSizes.length;

  allPoints.forEach(keyPoint => {
    if (displayMat) {
      if (config.showOverlayKeyPointCircles) {
        // Draw circles around `keyPoints`.
        const color = config.colorsRGB[keyPoint.colorIndex];
        cv.circle(displayMat, keyPoint.pt, keyPoint.size / 2 + 3, color, 2);
      }

      if (config.showOverlayKeyPointText) {
        // Draw text inside circles.
        cv.putText(
          displayMat,
          colorNames[keyPoint.colorIndex],
          add(keyPoint.pt, { x: -6, y: 6 }),
          cv.FONT_HERSHEY_DUPLEX,
          0.6,
          [255, 255, 255, 255]
        );
      }
    }
  });

  const pages = [];
  const vectorsBetweenCorners = { ...(dataToRemember.vectorsBetweenCorners || {}) };
  Object.keys(pointsById).forEach(id => {
    const points = pointsById[id];
    const potentialPoints = [];
    vectorsBetweenCorners[id] = vectorsBetweenCorners[id] || {};
    const dirVecs = directionVectorsById[id];

    // Store/update the angles and magnitudes between known points.
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (i !== j && points[i] && points[j]) {
          const diffVec = diff(points[j], points[i]);
          vectorsBetweenCorners[id][`${i}->${j}`] = {
            angle: Math.atan2(diffVec.y, diffVec.x) - Math.atan2(dirVecs[i].y, dirVecs[i].x),
            magnitude: norm(diffVec),
            // Once we see two corners for real, mark them as not mirrored, so
            // we won't override this when mirroring angles/magnitudes.
            mirrored: false,
          };
        }
      }
    }

    // Assuming the paper is rectangular, mirror angles/magnitudes.
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const thisSide = `${i}->${j}`;
        const otherSide = `${(i + 2) % 4}->${(j + 2) % 4}`;
        if (
          vectorsBetweenCorners[id][thisSide] &&
          (!vectorsBetweenCorners[id][otherSide] || vectorsBetweenCorners[id][otherSide].mirrored)
        ) {
          vectorsBetweenCorners[id][otherSide] = {
            ...vectorsBetweenCorners[id][thisSide],
            mirrored: true,
          };
        }
      }
    }

    // Find potential point for unknown points if we know the angle+magnitude with
    // another point.
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (points[i] && !points[j] && vectorsBetweenCorners[id][`${i}->${j}`]) {
          const { angle, magnitude } = vectorsBetweenCorners[id][`${i}->${j}`];
          const newAngle = angle + Math.atan2(dirVecs[i].y, dirVecs[i].x);
          potentialPoints[j] = potentialPoints[j] || [];
          potentialPoints[j].push({
            x: points[i].x + magnitude * Math.cos(newAngle),
            y: points[i].y + magnitude * Math.sin(newAngle),
          });
        }
      }
    }

    // Take the average of all potential points for each unknown point.
    for (let i = 0; i < 4; i++) {
      if (potentialPoints[i]) {
        points[i] = { x: 0, y: 0 };
        potentialPoints[i].forEach(vec => {
          points[i].x += vec.x / potentialPoints[i].length;
          points[i].y += vec.y / potentialPoints[i].length;
        });
      }
    }

    if (points[0] && points[1] && points[2] && points[3]) {
      const scaledPoints = shrinkPoints(avgKeyPointSize * 0.75, points).map(point =>
        projectPointToUnitSquare(point, videoMat, config.knobPoints)
      );

      const page = {
        points: scaledPoints,
        number: id,
        projectionMatrix: forwardProjectionMatrixForPoints(scaledPoints).adjugate(),
      };
      pages.push(page);

      if (displayMat && config.showOverlayProgram) {
        const reprojectedPoints = page.points.map(mapToKnobPointMatrix);

        cv.line(displayMat, reprojectedPoints[0], reprojectedPoints[1], [0, 0, 255, 255]);
        cv.line(displayMat, reprojectedPoints[2], reprojectedPoints[1], [0, 0, 255, 255]);
        cv.line(displayMat, reprojectedPoints[2], reprojectedPoints[3], [0, 0, 255, 255]);
        cv.line(displayMat, reprojectedPoints[3], reprojectedPoints[0], [0, 0, 255, 255]);
        cv.line(
          displayMat,
          div(add(reprojectedPoints[2], reprojectedPoints[3]), { x: 2, y: 2 }),
          div(add(reprojectedPoints[0], reprojectedPoints[1]), { x: 2, y: 2 }),
          [0, 0, 255, 255]
        );
      }
    }
  });

  let markers = []

  const grayImg = new cv.Mat(clippedVideoMat.size(), cv.CV_8UC1);
  cv.cvtColor(clippedVideoMat, grayImg, cv.COLOR_RGB2GRAY);

  const threshImg = new cv.Mat(grayImg.size(), cv.CV_8UC1);
  cv.threshold(
    grayImg,
    threshImg,
    100,
    255,
    cv.THRESH_BINARY_INV,
  );

  let debugMat = null;

  pages.forEach(page => {
    const mapToCropped = point => {
      return diff(mult(projectPoint(point, knobPointMatrix), { x: videoMat.cols, y: videoMat.rows }), videoROI)
    };

    const reprojectedPoints = page.points.map(mapToCropped)

    const pageContentPoints = cv.matFromArray(4, 1, cv.CV_32SC2,
      new Uint32Array([
        reprojectedPoints[0].x, reprojectedPoints[0].y,
        reprojectedPoints[3].x, reprojectedPoints[3].y,
        reprojectedPoints[2].x, reprojectedPoints[2].y,
        reprojectedPoints[1].x, reprojectedPoints[1].y,
      ])
    )
    
    let pts = new cv.MatVector();
    pts.push_back(pageContentPoints);

    const mask = new cv.Mat(threshImg.size().height, threshImg.size().width, cv.CV_8UC1, new cv.Scalar(0, 0, 0, 255))
    cv.fillPoly(mask, pts, [255, 255, 255, 255]);

    const pageContentMat = new cv.Mat(threshImg.size().height, threshImg.size().width, cv.CV_8UC1, new cv.Scalar(0, 0, 0, 255))
    cv.bitwise_and(threshImg, threshImg, pageContentMat, mask);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(pageContentMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE, videoROI);
    hierarchy.delete()

    const toDelete = []

    for (let i = 0; i < contours.size(); ++i) {
      const contour = contours.get(i);
      toDelete.push(contours[i])
      const area = cv.contourArea(contour);
      if (area < avgKeyPointSize) continue;

      const markerRect = cv.minAreaRect(contour);
      const markerPosition = projectPointToUnitSquare(markerRect.center, videoMat, config.knobPoints);

      const matchingPage = pages.find(({ points }) => {
        for (let j = 0; j < 4; j++) {
          const a = j;
          const b = (j + 1) % 4;

          const sideA = diff(points[a], markerPosition);
          const sideB = diff(points[b], markerPosition);

          let angle = Math.atan2(sideB.y, sideB.x) - Math.atan2(sideA.y, sideA.x);

          if (sideB.y < 0 && sideA.y > 0) {
            angle += 2 * Math.PI;
          }

          if (angle > Math.PI || angle < 0) {
            return false;
          }
        }

        return true;
      });

      if (!matchingPage) {
        continue;
      }

      const vertices = cv.RotatedRect.points(markerRect).map(v => projectPointToUnitSquare(v, videoMat, config.knobPoints));

      markers.push({
        paperNumber: matchingPage.number,
        globalCenter: markerPosition,
        globalPoints: vertices,
        paperCenter: projectPoint(markerPosition, matchingPage.projectionMatrix),
        paperPoints: vertices.map(v => projectPoint(v, matchingPage.projectionMatrix)),
        area,
      });
    }

    toDelete.forEach(o => o && o.delete())

    pageContentPoints.delete();
    pageContentMat.delete();
    mask.delete()
    contours.delete();
  });

  clippedVideoMat.delete();
  threshImg.delete();
  grayImg.delete();

  // Debug programs
  debugPages.forEach(({ points, number }) => {
    const scaledPoints = points.map(point => {
      const absPoint = mult(point, { x: videoMat.cols, y: videoMat.rows });
      return projectPointToUnitSquare(absPoint, videoMat, config.knobPoints);
    });

    const debugPage = {
      points: scaledPoints,
      number,
      projectionMatrix: forwardProjectionMatrixForPoints(scaledPoints).adjugate(),
    };
    pages.push(debugPage);
  });

  /*
  markers.forEach(m => {
    for (let i = 0; i < 4; i++) {
      cv.line(
        displayMat,
        m.globalPoints[i],
        m.globalPoints[(i + 1) % 4],
        [0, 255, 0, 255],
        2,
        cv.LINE_AA,
        0
      );
    }
  })
  */

  videoMat.delete();

  return {
    keyPoints,
    pages,
    markers,
    dataToRemember: { vectorsBetweenCorners },
    framerate: Math.round(1000 / (Date.now() - startTime)),
    debugMat,
  };
}
