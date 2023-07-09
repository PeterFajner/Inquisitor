import * as d3 from 'd3-color';
import { Delaunay, Voronoi } from 'd3-delaunay';
import { hsv } from 'd3-hsv';
import { mat4 } from 'gl-matrix';
import { FunctionComponent, useEffect, useRef, useState } from 'react';

const vertexShaderSource = `
		attribute vec4 aVertexPosition;
		attribute vec4 aVertexColor;

		uniform mat4 uModelViewMatrix;
		uniform mat4 uProjectionMatrix;

		varying lowp vec4 vColor;

		void main() {
			gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
			vColor = aVertexColor;
		}
	`;

const fragmentShaderSource = `
		varying lowp vec4 vColor;

		void main() {
			gl_FragColor = vColor;
		}
	`;

const randomRange = (min: number, max: number): number => {
    return Math.random() * (max - min) + min;
};

const generatePoint = (x: number, y: number, jitter: number) =>
    new Point(
        new Vector2(
            x + randomRange(x - jitter / 2, x + jitter / 2),
            y + randomRange(y - jitter / 2, y + jitter / 2)
        ),
        RGB.randomDark()
    );

class GameBoard {
    fixedPoints: Point[] = [];
    context: WebGL2RenderingContext;
    voronoi: Voronoi<Float32Array>;
    xmax: number;
    ymax: number;
    delaunayInput: Float64Array;
    pointDensity: number;
    programInfo: {
        program: WebGLProgram;
        attribLocations: { vertexPosition: number; vertexColor: number };
        uniformLocations: { projectionMatrix: any; modelViewMatrix: any };
        buffers: { position: WebGLBuffer; color: WebGLBuffer };
    };
    previousFrameTimestampMs: number;
    cutoffFramerate: number = 0.001;
    cutoffMinFrames: number = 10;
    targetFramerate: number = 10;
    numFramesBelowCutoff = 0;
    stoppedDueToLowFPS: boolean = false;
    stoppedManually: boolean = false;

    constructor(
        context: WebGL2RenderingContext,
        width: number,
        height: number,
        start = false,
        pointDensity: number = 30 // pixels per point
    ) {
        this.context = context;
        this.xmax = width;
        this.ymax = height;
        this.pointDensity = pointDensity;
        this.previousFrameTimestampMs = Date.now();

        console.log({
            clientWidth: (this.context.canvas as HTMLCanvasElement).clientWidth,
            clientHeight: (this.context.canvas as HTMLCanvasElement)
                .clientHeight,
            width,
            height,
        });

        // initialize canvas size
        context.viewport(0, 0, width, height);

        // initialize stationary points
        // todo may need to flip this upside down, since y = 0 is at the bottom of the screen? maybe flip the whole canvas?
        for (let i = 0; i < this.xmax; i += pointDensity) {
            for (let j = 0; j < this.ymax; j += pointDensity) {
                this.fixedPoints.push(
                    new Point(new Vector2(i, j), RGB.randomDark())
                );
            }
        }

        // setup delaunay input vector
        this.delaunayInput = new Float64Array(2 * this.fixedPoints.length);
        this.fixedPoints.forEach((point, index) => {
            const offset = 2 * index;
            this.delaunayInput[offset] = point.location.x;
            this.delaunayInput[offset + 1] = point.location.y;
        });

        // initialize delaunay representation
        const delaunay = new Delaunay(this.delaunayInput);

        // generate the voronoi pattern, with the bounds set to the edges of the canvas
        this.voronoi = delaunay.voronoi([0, 0, width, height]);

        // initialize shaders
        const vertexShader = context.createShader(
            context.VERTEX_SHADER
        ) as WebGLShader;
        context.shaderSource(vertexShader, vertexShaderSource);
        context.compileShader(vertexShader);
        if (!context.getShaderParameter(vertexShader, context.COMPILE_STATUS)) {
            console.error('Failed to compile vertex shader');
            console.error(context.getShaderInfoLog(vertexShader));
        }
        const fragmentShader = context.createShader(
            context.FRAGMENT_SHADER
        ) as WebGLShader;
        context.shaderSource(fragmentShader, fragmentShaderSource);
        context.compileShader(fragmentShader);
        if (
            !context.getShaderParameter(fragmentShader, context.COMPILE_STATUS)
        ) {
            console.error('Failed to compile fragment shader');
            console.error(context.getShaderInfoLog(fragmentShader));
        }

        // create shader program
        const shaderProgram = context.createProgram() as WebGLProgram;
        context.attachShader(shaderProgram, vertexShader);
        context.attachShader(shaderProgram, fragmentShader);
        context.linkProgram(shaderProgram);
        if (!context.getProgramParameter(shaderProgram, context.LINK_STATUS)) {
            console.error('Unable to initialize shader program');
            console.error(context.getProgramInfoLog(shaderProgram));
        }

        const vertexPosition = context.getAttribLocation(
            shaderProgram,
            'aVertexPosition'
        );
        const vertexColor = context.getAttribLocation(
            shaderProgram,
            'aVertexColor'
        );
        this.programInfo = {
            program: shaderProgram,
            attribLocations: {
                vertexPosition,
                vertexColor,
            },
            uniformLocations: {
                projectionMatrix: context.getUniformLocation(
                    shaderProgram,
                    'uProjectionMatrix'
                ),
                modelViewMatrix: context.getUniformLocation(
                    shaderProgram,
                    'uModelViewMatrix'
                ),
            },
            buffers: this.initBuffers(vertexPosition, vertexColor),
        };

        // set clear colour to be black, and clear everything on clear()
        context.clearColor(0, 0, 0, 1);
        context.clearDepth(1);

        // enable depth testing and make near things obscur far things
        context.enable(context.DEPTH_TEST);
        context.depthFunc(context.LEQUAL);
        // define the projection bounds
        const projectionMatrix = mat4.create();
        mat4.ortho(projectionMatrix, -1, 1, -1, 1, -100, 100);

        // create a matrix to store the current drawing position - just keep the default
        const modelViewMatrix = mat4.create();
        // flip upside-down, so that y = 0 is at the top
        mat4.scale(modelViewMatrix, modelViewMatrix, [1, -1, 1]);

        // select drawing program
        context.useProgram(this.programInfo.program);

        // set shader uniforms (static each frame)
        context.uniformMatrix4fv(
            this.programInfo.uniformLocations.projectionMatrix,
            false,
            projectionMatrix
        );
        context.uniformMatrix4fv(
            this.programInfo.uniformLocations.modelViewMatrix,
            false,
            modelViewMatrix
        );

        if (start) {
            this.loop();
        } else {
            this.draw();
        }
    }

    /**
     * Get the color of the point at the given index
     * @param index
     */
    getColor = (index: number): d3.RGBColor =>
        this.fixedPoints[index].color.rgb();

    /**
     * Scale a vertex from [0 0 xmax ymax] space to [-1 -1 1 1] space
     * @param vertex
     */
    scale = (x: number, y: number): [number, number] => [
        (x * 2) / this.xmax - 1,
        (y * 2) / this.ymax - 1,
    ];

    initBuffers(
        vertexPosition: number,
        vertexColor: number
    ): { position: WebGLBuffer; color: WebGLBuffer } {
        const context = this.context;

        // init vertex buffer
        const positionBuffer = context.createBuffer() as WebGLBuffer;
        context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
        context.bufferData(
            context.ARRAY_BUFFER,
            new Float32Array([]),
            context.STATIC_DRAW
        );

        // init color buffer
        const colorBuffer = context.createBuffer() as WebGLBuffer;
        context.bindBuffer(context.ARRAY_BUFFER, colorBuffer);
        context.bufferData(
            context.ARRAY_BUFFER,
            new Float32Array([]),
            context.STATIC_DRAW
        );

        // tell webgl how to pull positions from positionBuffer into the vertexPosition attribute
        {
            const numComponents = 2; // every iteration grab a vertex: xy
            const type = context.FLOAT; // datatype is 32-bit float
            const normalize = false;
            const stride = 0; // not sure what this is for
            const offset = 0;
            context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
            context.vertexAttribPointer(
                vertexPosition,
                numComponents,
                type,
                normalize,
                stride,
                offset
            );
            context.enableVertexAttribArray(vertexPosition);
        }

        // tell webgl how to pull colors from colorBuffer into the vertexColor attribute
        {
            const numComponents = 4; // rgba
            const type = context.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            context.bindBuffer(context.ARRAY_BUFFER, colorBuffer);
            context.vertexAttribPointer(
                vertexColor,
                numComponents,
                type,
                normalize,
                stride,
                offset
            );
            context.enableVertexAttribArray(vertexColor);
        }

        return { position: positionBuffer, color: colorBuffer };
    }

    refreshBuffers(points: Point[]) {
        const context = this.context;
        // vertices and their corresponding colors
        const vertices: number[] = []; // x y x y x y x y
        const colors: number[] = []; // r g b a r g b a r g b a r g b a
        for (let p of points) {
            const fourCorners = [
                [p.location.x, p.location.y],
                [p.location.x, p.location.y + this.pointDensity],
                [
                    p.location.x + this.pointDensity,
                    p.location.y + this.pointDensity,
                ],
                [p.location.x + this.pointDensity, p.location.y],
                [p.location.x, p.location.y],
            ];
            const scaledCorners = fourCorners.map((p) =>
                this.scale(p[0], p[1])
            );
            const scaledColor = [p.color.r, p.color.g, p.color.b].map(
                (c) => c / 255
            );
            for (let corner of scaledCorners) {
                vertices.push(...corner);
                colors.push(...scaledColor, 1);
            }
        }

        // fill vertex buffer
        context.bindBuffer(
            context.ARRAY_BUFFER,
            this.programInfo.buffers.position
        );
        context.bufferData(
            context.ARRAY_BUFFER,
            new Float32Array(vertices),
            context.STATIC_DRAW
        );

        // fill color buffer
        context.bindBuffer(
            context.ARRAY_BUFFER,
            this.programInfo.buffers.color
        );
        context.bufferData(
            context.ARRAY_BUFFER,
            new Float32Array(colors),
            context.STATIC_DRAW
        );

        const reconstructed = [];
        for (
            let i = 0, v = 0, c = 0;
            v < vertices.length;
            i++, v += 2, c += 4
        ) {
            reconstructed.push([
                vertices[v],
                vertices[v + 1],
                colors[c],
                colors[c + 1],
                colors[c + 2],
            ]);
        }

        console.info({ reconstructed, sample: reconstructed[1800] });
    }

    loop() {
        // calculate fps
        const currentFrameTimestampMs = Date.now();
        const timeElapsedMs =
            currentFrameTimestampMs - this.previousFrameTimestampMs;
        this.previousFrameTimestampMs = currentFrameTimestampMs;
        const fps = 1000 / timeElapsedMs;
        // warn if fps is below cutoff threshold
        if (fps < this.cutoffFramerate) {
            console.warn(
                `fps is ${fps}, below threshold of ${this.cutoffFramerate}`
            );
        }
        // if fps is too low for too many frames, stop the animation
        if (fps > this.cutoffFramerate) {
            this.numFramesBelowCutoff = 0;
        } else {
            this.numFramesBelowCutoff++;
        }
        if (this.numFramesBelowCutoff > this.cutoffMinFrames) {
            this.stoppedDueToLowFPS = true;
        }
        if (this.stoppedDueToLowFPS) {
            console.debug(
                `Ran under ${this.cutoffFramerate} fps for ${this.cutoffMinFrames} frames, stopping animation`
            );
            return;
        }
        if (this.stoppedManually) {
            return;
        }

        for (let point of this.fixedPoints) {
            const move1 = Math.sin(Date.now() * 10);
            const move2 = Math.sin(((point.location.x * 10) % 10) - 5);
            const move = move1 + move2;
            console.log({ move1, move2, move });
            point.location.x += move;
        }

        this.delaunayInput = new Float64Array(2 * this.fixedPoints.length);
        this.fixedPoints.forEach((point, index) => {
            const offset = 2 * index;
            this.delaunayInput[offset] = point.location.x;
            this.delaunayInput[offset + 1] = point.location.y;
        });
        const delaunay = new Delaunay(this.delaunayInput);
        this.voronoi = delaunay.voronoi([0, 0, this.xmax, this.ymax]);

        this.draw();

        // sleep
        setTimeout(() => {
            this.loop();
        }, 1000 / this.targetFramerate);
    }

    stop() {
        this.stoppedManually = true;
    }

    start() {
        this.stoppedManually = false;
        this.loop();
    }

    draw() {
        // recalculate voronoi
        this.voronoi.update();
        const context = this.context;

        console.debug({
            voronoi: this.voronoi,
            delaunayInput: this.delaunayInput,
        });

        // refresh buffers
        this.refreshBuffers(this.fixedPoints);

        // draw each square - it has 5 points, since we need to return to the start at the end
        for (let p = 0; p < this.fixedPoints.length; p += 1) {
            context.drawArrays(context.TRIANGLE_FAN, p * 5, 5);
        }
    }

    resize(newWidth: number, newHeight: number, restart = false) {
        this.stop();
        // generate points to fill new space
        // right
        if (newWidth > this.xmax) {
            for (
                // the complex-ish math here is to make sure we start at the next square boundary
                let i =
                    Math.floor(this.xmax / this.pointDensity + 1) *
                    this.pointDensity;
                i < newWidth;
                i += this.pointDensity
            ) {
                for (let j = 0; j < this.ymax; j += this.pointDensity) {
                    this.fixedPoints.push(
                        new Point(new Vector2(i, j), RGB.randomDark())
                    );
                }
            }
        }
        // bottom
        if (newHeight > this.ymax) {
            for (let i = 0; i < this.xmax; i += this.pointDensity) {
                for (
                    let j =
                        Math.floor(this.ymax / this.pointDensity + 1) *
                        this.pointDensity;
                    j < newHeight;
                    j += this.pointDensity
                ) {
                    this.fixedPoints.push(
                        new Point(new Vector2(i, j), RGB.randomDark())
                    );
                }
            }
        }
        // bottom right corner
        if (newWidth > this.xmax && newHeight > this.ymax) {
            for (
                let i =
                    Math.floor(this.xmax / this.pointDensity + 2) *
                    this.pointDensity;
                i < newWidth;
                i++
            ) {
                for (
                    let j =
                        Math.floor(this.ymax / this.pointDensity + 2) *
                        this.pointDensity;
                    j < newHeight;
                    j++
                ) {
                    this.fixedPoints.push(
                        new Point(new Vector2(i, j), RGB.randomDark())
                    );
                }
            }
        }

        // regenerate voronoi
        this.delaunayInput = new Float64Array(2 * this.fixedPoints.length);
        this.fixedPoints.forEach((point, index) => {
            const offset = 2 * index;
            this.delaunayInput[offset] = point.location.x;
            this.delaunayInput[offset + 1] = point.location.y;
        });
        const delaunay = new Delaunay(this.delaunayInput);
        this.voronoi = delaunay.voronoi([0, 0, newWidth, newHeight]);

        console.log({ voronoi: this.voronoi });

        // resize internal canvas
        this.xmax = newWidth;
        this.ymax = newHeight;
        this.context.viewport(0, 0, newWidth, newHeight);
        if (restart) {
            this.start();
        } else {
            this.draw();
        }
    }
}

class Point {
    location: Vector2;
    color: d3.RGBColor;

    constructor(location: Vector2, color: d3.RGBColor | null = null) {
        this.location = location;
        this.color = color ?? RGB.random();
    }

    toString() {
        return this.location.toString();
    }
}

class Vector2 {
    x: number;
    y: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    toString() {
        return `(${this.x}, ${this.y})`;
    }

    minus(other: Vector2): Vector2 {
        return new Vector2(this.x - other.x, this.y - other.y);
    }

    plus(other: Vector2): Vector2 {
        return new Vector2(this.x + other.x, this.y + other.y);
    }
}

class RGB {
    r: number;
    g: number;
    b: number;

    /**
     * Initialize a new RGB value
     * @param r 0...1
     * @param g 0...1
     * @param b 0...1
     */
    constructor(r: number, g: number, b: number) {
        this.r = r;
        this.g = g;
        this.b = b;
    }

    static random(): d3.RGBColor {
        const color = d3.rgb(
            `rgb(${Math.random()}, ${Math.random()}, ${Math.random()})`
        );
        console.debug('color', color);
        return color;
    }

    static randomDarkOld(): d3.RGBColor {
        const h = Math.random() * 90;
        const s = Math.random() * 0.2 + 0.2;
        const v = Math.random() * 0.2;
        const color = hsv(h, s, v).rgb() as d3.RGBColor;
        return color;
    }

    static randomDark(): d3.RGBColor {
        const h = Math.random() * 30;
        const s = Math.random() * 0.2 + 0.2;
        const v = Math.random() * 0.1;
        const color = hsv(h, s, v).rgb() as d3.RGBColor;
        return color;
    }

    static randomBright(): d3.RGBColor {
        const h = Math.random() * 90 + 90;
        const s = Math.random() * 0.2 + 0.8;
        const v = Math.random() * 0.2 + 0.8;
        const color = hsv(h, s, v).rgb() as d3.RGBColor;
        return color;
    }

    /**
     * @returns rgb(r*255, g*255, b*255)
     */
    toString(): string {
        return `rgb(${this.r * 255}, ${this.g * 255}, ${this.b * 255})`;
    }
}

export const Background: FunctionComponent<{}> = ({}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [gameBoard, setGameBoard] = useState<GameBoard>();

    useEffect(() => {
        if (!gameBoard) {
            const canvas = canvasRef.current as HTMLCanvasElement;
            const context = canvas.getContext(
                'webgl2'
            ) as WebGL2RenderingContext;
            const board = new GameBoard(
                context,
                window.innerWidth,
                window.innerHeight,
                false
            );
            setGameBoard((oldBoard) => {
                oldBoard?.stop();
                return board;
            });
        }
    }, [gameBoard]);

    useEffect(() => {
        if (gameBoard) {
            const canvas = canvasRef.current as HTMLCanvasElement;
            const context = canvas.getContext(
                'webgl2'
            ) as WebGL2RenderingContext;
            const App = document.querySelector('#App');
            const observer = new ResizeObserver((event) => {
                const newWidth = event[0].contentRect.width;
                const newHeight = event[0].contentRect.height;
                context.canvas.width = newWidth;
                context.canvas.height = newHeight;
                gameBoard.resize(newWidth, newHeight);
            });
            if (App) {
                observer.observe(App);
            }
            return () => observer.disconnect();
        }
    }, [gameBoard]);

    return (
        <canvas
            ref={canvasRef}
            width={window.innerWidth}
            height={window.innerHeight}
            id="voronoiRoverCanvas"
        />
    );
};
