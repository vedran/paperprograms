import React from 'react';
import xhr from 'xhr';

import { codeToName, codeToPrint, getApiUrl } from '../utils';
import { colorNames, paperSizes, commonPaperSizeNames, otherPaperSizeNames } from '../constants';
import { printCalibrationPage, printPage } from './printPdf';

import helloWorld from './helloWorld';
import styles from './CameraMain.css';

import CameraVideo from './CameraVideo';

export default class CameraMain extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      pageWidth: 1,
      framerate: 0,
      selectedColorIndex: -1,
      spaceData: { pages: [], programs: [] },
      autoPrintedNumbers: [],
      isEditingSpaceUrl: false,
      spaceUrlSwitcherValue: props.config.spaceUrl,
      debugPages: [],
    };
  }

  componentDidMount() {
    window.addEventListener('resize', this._updatePageWidth);
    this._updatePageWidth();
    this._pollSpaceUrl();
  }

  _pollSpaceUrl = () => {
    const targetTimeMs = 500;
    const beginTimeMs = Date.now();
    xhr.get(this.props.config.spaceUrl, { json: true }, (error, response) => {
      if (error) {
        console.error(error); // eslint-disable-line no-console
      } else {
        this.setState({ spaceData: response.body }, () => {
          if (this.props.config.autoPrintEnabled) this._autoPrint();
          this._programsChange(this.props.pages, response.body.programs);
        });
      }

      const elapsedTimeMs = Date.now() - beginTimeMs;
      clearTimeout(this._timeout);
      this._timeout = setTimeout(this._pollSpaceUrl, Math.max(0, targetTimeMs - elapsedTimeMs));
    });
  };

  _updatePageWidth = () => {
    this.setState({ pageWidth: document.body.clientWidth });
  };

  _print = page => {
    printPage(
      page.number,
      this.props.config.paperSize
    );
    this._markPrinted(page, true);
  };

  _printCalibration = () => {
    printCalibrationPage(this.props.config.paperSize);
  };

  _markPrinted = (page, printed) => {
    xhr.post(
      getApiUrl(this.state.spaceData.spaceName, `/pages/${page.number}/markPrinted`),
      { json: { printed } },
      (error, response) => {
        if (error) {
          console.error(error); // eslint-disable-line no-console
        } else {
          this.setState({ spaceData: response.body });
        }
      }
    );
  };

  _autoPrint = () => {
    const toPrint = this.state.spaceData.pages.filter(
      page => !page.printed && !this.state.autoPrintedNumbers.includes(page.number)
    );
    if (toPrint.length > 0) {
      this.setState(
        { autoPrintedNumbers: this.state.autoPrintedNumbers.concat([toPrint[0].number]) },
        () => this._print(toPrint[0])
      );
    }
  };

  _createHelloWorld = () => {
    xhr.post(
      getApiUrl(this.state.spaceData.spaceName, '/pages'),
      null,
      error => {
        if (error) {
          console.error(error); // eslint-disable-line no-console
        }
      }
    );
  };

  _createDebugPage = number => {
    const paperSize = paperSizes[this.props.config.paperSize];
    const widthToHeightRatio = paperSize[0] / paperSize[1];
    const height = 0.2;
    const width = height * widthToHeightRatio;

    const debugPages = this.state.debugPages;
    const newPage = {
      number,
      points: [
        { x: 0.0, y: 0.0 },
        { x: width, y: 0.0 },
        { x: width, y: height },
        { x: 0.0, y: height },
      ],
    };
    debugPages.push(newPage);
    this.setState({ debugPages });
  };

  _programsChange = (pages, programs) => {
    this.props.onProgramsChange(
      pages
        .map(page => {
          const pageWithData = this.state.spaceData.pages.find(
            page2 => page2.number.toString() === page.number.toString()
          );
          if (!pageWithData) return;
          return {
            ...page,
            programId: pageWithData.programId,
          };
        })
        .filter(Boolean),
      programs
    );
  };

  _assignProgramToPage = (programId, pageNumber) => {
    if (!programId) {
      xhr.delete(getApiUrl(this.state.spaceData.spaceName, `/pages/${pageNumber}/program`),
        { json: {} },
        () => { }
      );
    } else {
      xhr.put(getApiUrl(this.state.spaceData.spaceName, `/pages/${pageNumber}/program/${programId}`),
        { json: {} },
        (error, response) => {
          if (error) {
            console.error(error); // eslint-disable-line no-console
          } else {
            this.setState({ spaceData: response.body });
          }
        }
      );
    }
  };

  render() {
    const padding = parseInt(styles.cameraMainPadding);
    const sidebarWidth = parseInt(styles.cameraMainSidebarWidth);
    const editorUrl = new URL(
      `editor.html?${this.state.spaceData.spaceName}`,
      window.location.origin
    ).toString();

    return (
      <div className={styles.root}>
        <div className={styles.appRoot}>
          <div className={styles.video}>
            <CameraVideo
              width={this.state.pageWidth - padding * 3 - sidebarWidth}
              config={this.props.config}
              onConfigChange={this.props.onConfigChange}
              onProcessVideo={({ pages, markers, framerate }) => {
                this.setState({ framerate });
                this._programsChange(pages, this.props.programs);
                this.props.onMarkersChange(markers);
              }}
              allowSelectingDetectedPoints={this.state.selectedColorIndex !== -1}
              onSelectPoint={({ color, size }) => {
                if (this.state.selectedColorIndex === -1) return;

                const colorsRGB = this.props.config.colorsRGB.slice();
                colorsRGB[this.state.selectedColorIndex] = color.map(value => Math.round(value));

                const paperDotSizes = this.props.config.paperDotSizes.slice();
                paperDotSizes[this.state.selectedColorIndex] = size;

                this.props.onConfigChange({ ...this.props.config, colorsRGB, paperDotSizes });
                this.setState({ selectedColorIndex: -1 });
              }}
              debugPages={this.state.debugPages}
              removeDebugPage={program => {
                const debugPages = this.state.debugPages.filter(p => p !== program);
                this.setState({ debugPages });
              }}
            />
          </div>
          <div className={styles.sidebar}>
            <div className={`${styles.sidebarSection} ${styles.create}`}>
              <button onClick={this._createHelloWorld}>Create Page</button>
              <a href={editorUrl} target="_blank" className={styles.editorAnchor}>
                Open Editor
              </a>
            </div>
            <div className={styles.sidebarSection}>
              <h3>Paper Programs</h3>
              <div className={styles.sidebarSubSection}>
                {this.state.spaceData.pages.map(page => {
                  const curPageProgram = this.state.spaceData.programs.find(p => p.id == page.programId)
                  return <div key={page.number} style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ marginRight: 4 }}>
                      <a style={{ cursor: 'pointer' }} onClick={() => this._print(page)}>
                        Page {page.number}
                      </a>
                      &nbsp;
                      runs
                    </div>
                    <select defaultValue={page.programId} onChange={(event) => this._assignProgramToPage(event.target.value, page.number)}>
                      <option>
                        nothing
                      </option>
                      {this.state.spaceData.programs.map(program => (
                        <option key={program.id} value={program.id}>
                          {codeToName(program.currentCode)}
                        </option>
                      ))}
                    </select>
                  </div>
                })}
              </div>
            </div>

            {false && <div className={styles.sidebarSection}>
              <h3>Printing</h3>
              <div className={styles.sidebarSubSection}>
                <span>Paper Size: </span>
                <select
                  value={this.props.config.paperSize}
                  onChange={event => {
                    const paperSize = event.target.value;
                    this.props.onConfigChange({ ...this.props.config, paperSize });
                  }}
                >
                  <optgroup label="Common">
                    {commonPaperSizeNames.map(name => {
                      return (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      );
                    })}
                  </optgroup>
                  <optgroup label="Other">
                    {otherPaperSizeNames.map(name => {
                      return (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      );
                    })}
                  </optgroup>
                </select>
              </div>
              <div className={styles.sidebarSubSection}>
                <h4 className={styles.headerWithOption}>Queue</h4>
                <div className={styles.optionWithHeader}>
                  <label htmlFor="show-printed">show printed</label>
                  <input
                    type="checkbox"
                    name="show-printed"
                    checked={this.props.config.showPrintedInQueue}
                    onChange={() =>
                      this.props.onConfigChange({
                        ...this.props.config,
                        showPrintedInQueue: !this.props.config.showPrintedInQueue,
                      })
                    }
                  />
                </div>
              </div>
              <div className={`${styles.sidebarSubSection} ${styles.printQueue}`}>
                <div>
                  {this.state.spaceData.pages
                    .filter(page => !page.printed || this.props.config.showPrintedInQueue)
                    .map(page => (
                      <div
                        key={page.number}
                        className={[
                          styles.printQueueItem,
                          page.printed
                            ? styles.printQueueItemPrinted
                            : styles.printQueueItemNotPrinted,
                        ].join(' ')}
                        onClick={() => this._print(page)}
                      >
                        <span className={styles.printQueueItemContent}>
                          <span className={styles.printQueueItemName}>
                            <strong>#{page.number}</strong> {codeToName(page.currentCode)}{' '}
                          </span>
                          <span
                            className={styles.printQueueItemToggle}
                            onClick={event => {
                              event.stopPropagation();
                              this._markPrinted(page, !page.printed);
                            }}
                          >
                            {page.printed ? '[show]' : '[hide]'}
                          </span>
                        </span>
                        {this.state.debugPages.find(p => p.number === page.number) ===
                        undefined ? (
                          <span
                            className={styles.printQueueDebug}
                            onClick={event => {
                              event.stopPropagation();
                              this._createDebugPage(page.number);
                            }}
                          >
                            [Preview]
                          </span>
                        ) : (
                          ''
                        )}
                      </div>
                    ))}
                </div>
              </div>
              <div>
                <button onClick={this._printCalibration}>Print Calibration Page</button>{' '}
              </div>
              <div>
                <input
                  type="checkbox"
                  name="autoPrint"
                  checked={this.props.config.autoPrintEnabled}
                  onChange={() =>
                    this.props.onConfigChange({
                      ...this.props.config,
                      autoPrintEnabled: !this.props.config.autoPrintEnabled,
                    })
                  }
                />
                <label htmlFor="autoPrint">auto-print</label>
                <div className={styles.note}>(start Chrome with "--kiosk-printing" flag)</div>
              </div>
            </div>}

            <div className={styles.sidebarSection}>
              <h3>Calibration</h3>
              <div className={styles.sidebarSubSection}>
                {this.props.config.colorsRGB.map((color, colorIndex) => (
                  <div
                    key={colorIndex}
                    className={[
                      styles.colorListItem,
                      this.state.selectedColorIndex === colorIndex && styles.colorListItemSelected,
                    ].join(' ')}
                    style={{ background: `rgb(${color.slice(0, 3).join(',')})` }}
                    onClick={() =>
                      this.setState(state => ({
                        selectedColorIndex:
                          state.selectedColorIndex === colorIndex ? -1 : colorIndex,
                      }))
                    }
                  >
                    <strong>{colorNames[colorIndex]}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.sidebarSection}>
              <h3 className={styles.headerWithOption}>Detection</h3>
              <div className={styles.optionWithHeader}>
                <input
                  type="checkbox"
                  name="freezeDetection"
                  checked={this.props.config.freezeDetection}
                  onChange={() =>
                    this.props.onConfigChange({
                      ...this.props.config,
                      freezeDetection: !this.props.config.freezeDetection,
                    })
                  }
                />
                <label htmlFor="freezeDetection">pause</label>
              </div>

              <div className={styles.sidebarSubSection}>
                <span>Accuracy</span>
                <input
                  name="scaleFactor"
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={this.props.config.scaleFactor}
                  onChange={event => {
                    this.props.onConfigChange({
                      ...this.props.config,
                      scaleFactor: event.target.valueAsNumber,
                    });
                  }}
                />
                <span>Performance</span>
              </div>
              <div className={styles.sidebarSubSection}>
                Framerate <strong>{this.state.framerate}</strong>
              </div>

              <h4>Overlays</h4>
              <div className={styles.sidebarSubSection}>
                <input
                  type="checkbox"
                  checked={this.props.config.showOverlayKeyPointCircles}
                  onChange={() =>
                    this.props.onConfigChange({
                      ...this.props.config,
                      showOverlayKeyPointCircles: !this.props.config.showOverlayKeyPointCircles,
                    })
                  }
                />{' '}
                keypoint circles
              </div>

              <div className={styles.sidebarSubSection}>
                <input
                  type="checkbox"
                  checked={this.props.config.showOverlayKeyPointText}
                  onChange={() =>
                    this.props.onConfigChange({
                      ...this.props.config,
                      showOverlayKeyPointText: !this.props.config.showOverlayKeyPointText,
                    })
                  }
                />{' '}
                keypoint text
              </div>

              <div className={styles.sidebarSubSection}>
                <input
                  type="checkbox"
                  checked={this.props.config.showOverlayComponentLines}
                  onChange={() =>
                    this.props.onConfigChange({
                      ...this.props.config,
                      showOverlayComponentLines: !this.props.config.showOverlayComponentLines,
                    })
                  }
                />{' '}
                component lines
              </div>

              <div className={styles.sidebarSubSection}>
                <input
                  type="checkbox"
                  checked={this.props.config.showOverlayShapeId}
                  onChange={() =>
                    this.props.onConfigChange({
                      ...this.props.config,
                      showOverlayShapeId: !this.props.config.showOverlayShapeId,
                    })
                  }
                />{' '}
                shape ids
              </div>

              <div className={styles.sidebarSubSection}>
                <input
                  type="checkbox"
                  checked={this.props.config.showOverlayProgram}
                  onChange={() =>
                    this.props.onConfigChange({
                      ...this.props.config,
                      showOverlayProgram: !this.props.config.showOverlayProgram,
                    })
                  }
                />{' '}
                programs
              </div>
            </div>
            <div className={styles.sidebarSection}>
              <h3 className={styles.sidebarSubSection}>Space</h3>
              {!this.state.isEditingSpaceUrl ? (
                <div>
                  <div>
                    <a className={styles.spaceUrl} href={this.props.config.spaceUrl}>
                      {this.props.config.spaceUrl}
                    </a>
                  </div>
                  <div>
                    <button onClick={() => this.setState({ isEditingSpaceUrl: true })}>
                      Change Space
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <input
                    className={styles.spaceNameInput}
                    value={this.state.spaceUrlSwitcherValue}
                    onChange={event => this.setState({ spaceUrlSwitcherValue: event.target.value })}
                  />
                  <div>
                    <button
                      onClick={() => {
                        this.props.onConfigChange({
                          ...this.props.config,
                          spaceUrl: this.state.spaceUrlSwitcherValue,
                        });
                        this.setState({ isEditingSpaceUrl: false });
                      }}
                    >
                      switch to new url
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
}
