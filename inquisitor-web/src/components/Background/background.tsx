import { Delaunay, Voronoi } from 'd3-delaunay';
import { hsv } from 'd3-hsv';
import * as d3 from 'd3-color';
import { mat4 } from 'gl-matrix';
import { useEffect, useRef, useState } from 'react';
import { FunctionComponent } from 'react';
import { RGBColor } from 'd3';

// the animation will aim to run at this framerate
const TARGET_FPS = 60;

// if the animation slows below CUTOFF_FPS for more than
// CUTOFF_MIN_FRAMES frames, the animation will stop
const CUTOFF_FPS = 45;
const CUTOFF_MIN_FRAMES = 10;

// rovers will appear and disappear this many pixels past the edge of the canvas
const CLIP_DISTANCE = 100;

const ROVER_MIN_SPEED = 5;
const ROVER_MAX_SPEED = 15;

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

function randomRange(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

class GameBoard {
    fixedPoints: Point[] = [];
    rovers: Rover[] = [];
    context: WebGL2RenderingContext;
    numRovers: number;
    previousFrameTimestampMs: number;
    cutoffFramerate: number;
    cutoffMinFrames: number;
    voronoi: Voronoi<Float32Array>;
    xmax: number;
    ymax: number;
    delaunayInput: Float64Array;
    numFramesBelowCutoff = 0;
    automaticallyStopped = false;
    manuallyStopped = false;
    programInfo: {
        program: WebGLProgram;
        attribLocations: { vertexPosition: number; vertexColor: number };
        uniformLocations: { projectionMatrix: any; modelViewMatrix: any };
        buffers: { position: WebGLBuffer; color: WebGLBuffer };
    };

    constructor(
        context: WebGL2RenderingContext,
        width: number,
        height: number,
        numFixedPoints: number = 10,
        numRovers: number = 5,
        cutoffFramerate: number = CUTOFF_FPS,
        cutoffMinFrames: number = CUTOFF_MIN_FRAMES
    ) {
        this.context = context;
        this.cutoffFramerate = cutoffFramerate;
        this.cutoffMinFrames = cutoffMinFrames;
        this.numRovers = numRovers;
        this.previousFrameTimestampMs = Date.now();
        this.xmax = (this.context.canvas as HTMLCanvasElement).clientWidth;
        this.ymax = (this.context.canvas as HTMLCanvasElement).clientHeight;

        console.debug({
            xmax: this.xmax,
            ymax: this.ymax,
            width: context.canvas.width,
            height: context.canvas.height,
        });

        // initialize canvas size
        context.viewport(0, 0, context.canvas.width, context.canvas.height);

        // initialize stationary points
        for (let i = 0; i < numFixedPoints; i++) {
            const x =
                Math.random() *
                (context.canvas as HTMLCanvasElement).clientWidth;
            const y =
                Math.random() *
                (context.canvas as HTMLCanvasElement).clientHeight;
            const color = RGB.randomDark();
            const point = new Point(new Vector2(x, y), color);
            this.fixedPoints.push(point);
        }

        // initialize rovers
        for (let i = 0; i < numRovers; i++) {
            this.rovers.push(
                new Rover(
                    new Vector2(0, 0),
                    null,
                    null,
                    randomRange(ROVER_MIN_SPEED, ROVER_MAX_SPEED),
                    RGB.randomBright()
                )
            );
        }

        // setup delaunay input vector
        this.delaunayInput = new Float64Array(
            2 * (this.fixedPoints.length + this.rovers.length)
        );
        this.fixedPoints.forEach((point, index) => {
            const offset = 2 * index;
            this.delaunayInput[offset] = point.location.x;
            this.delaunayInput[offset + 1] = point.location.y;
        });
        this.rovers.forEach((rover, index) => {
            const offset = 2 * (index + this.fixedPoints.length);
            this.delaunayInput[offset] = rover.location.x;
            this.delaunayInput[offset] = rover.location.y;
        });

        // initialize delaunay representation
        const delaunay = new Delaunay(this.delaunayInput);

        // get the voronoi diagram, with the bounds set to the edges of the canvas
        this.voronoi = delaunay.voronoi([
            0 - CLIP_DISTANCE,
            0 - CLIP_DISTANCE,
            this.xmax + CLIP_DISTANCE,
            this.ymax + CLIP_DISTANCE,
        ]);

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
        // create camera perspective matrix
        const fieldOfView = Math.PI / 4; // 45°
        const aspectRatio = this.xmax / this.ymax;
        const clipNear = 0.1;
        const clipFar = 100;
        const projectionMatrix = mat4.create();
        mat4.perspective(
            projectionMatrix,
            fieldOfView,
            aspectRatio,
            clipNear,
            clipFar
        );

        // create a matrix to store the current drawing position
        const modelViewMatrix = mat4.create();
        mat4.translate(modelViewMatrix, modelViewMatrix, [-0.0, 0.0, -2.8]);

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
    }

    /**
     * Get the color of the point at this.fixedPoints.concat(this.rovers)[index]
     * @param index
     */
    getColor(index: number): d3.RGBColor {
        if (index < this.fixedPoints.length) {
            return this.fixedPoints[index].color.rgb();
        } else {
            return this.rovers[index - this.fixedPoints.length].color.rgb();
        }
    }

    /**
     * Scale a vertex from [0 0 xmax ymax] space to [-1 -1 1 1] space
     * @param vertex
     */
    scale(vertex: Delaunay.Point): [number, number] {
        const x = (vertex[0] / this.xmax) * 2 - 1;
        const y = (vertex[1] / this.ymax) * 2 - 1;
        return [x, y];
    }

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
            console.debug({ this: this });
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

    refreshBuffers(voronoiCells: (Delaunay.Polygon & { index: number })[]) {
        const context = this.context;
        // vertices and their corresponding colors
        const vertices: number[] = []; // x y x y x y x y
        const colors: number[] = []; // r g b a r g b a r g b a r g b a
        voronoiCells.forEach((cell, index) => {
            const color = this.getColor(index).rgb();
            const r = color.r / 255;
            const g = color.g / 255;
            const b = color.b / 255;
            cell.forEach((vertex, index) => {
                if (index > 0) {
                    vertices.push(this.scale(vertex)[0]);
                    vertices.push(this.scale(vertex)[1]);
                    colors.push(r);
                    colors.push(g);
                    colors.push(b);
                    colors.push(1);
                }
            });
        });

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
    }

    stop() {
        this.manuallyStopped = true;
    }

    loop(once = false) {
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
            this.automaticallyStopped = true;
        }
        if (this.automaticallyStopped) {
            console.debug(
                `Ran under ${this.cutoffFramerate} fps for ${this.cutoffMinFrames} frames, stopping animation`
            );
            return;
        }
        if (this.manuallyStopped) {
            return;
        }

        this.rovers.forEach((rover, index) => {
            // respawn rover if it has gone beyond the clip distance
            if (
                rover.location == null ||
                rover.spawn == null ||
                rover.despawn == null ||
                rover.location.x < 0 - CLIP_DISTANCE ||
                rover.location.x > this.xmax + CLIP_DISTANCE ||
                rover.location.y < 0 - CLIP_DISTANCE ||
                rover.location.y > this.ymax + CLIP_DISTANCE
            ) {
                // set a new colour
                rover.color = RGB.randomBright();
                // set a new speed
                rover.speed = randomRange(ROVER_MIN_SPEED, ROVER_MAX_SPEED);
                // decide an on-screen location for the rover to pass through
                const location = new Vector2(
                    Math.random() *
                        (this.context.canvas as HTMLCanvasElement).clientWidth,
                    Math.random() *
                        (this.context.canvas as HTMLCanvasElement).clientHeight
                );
                // decide an angle for the rover to pass through at
                const angle = Math.random() * 2 * Math.PI;
                // slope and y-intercept of the vector created by the angle passing through the location
                // slope and y-intercept of the vector create by angle passing through location
                const m = Math.sin(angle) / Math.cos(angle);
                const b = location.y - m * location.x;
                // possible offscreen spawn and despawn points along the vector are...
                const xUp = -b / m; // y = 0
                const xDown = (this.ymax - b) / m; // y = ymax
                const yLeft = b; // x = 0
                const yRight = m * this.xmax + b; // x = xmax
                const pointsOfInterest = [
                    new Vector2(xUp, 0),
                    new Vector2(xDown, this.ymax),
                    new Vector2(0, yLeft),
                    new Vector2(this.xmax, yRight),
                ];
                // unless the line is perfectly vertical, sorting by x coord lets us pick the points at either edge
                pointsOfInterest.sort((a, b) => a.x - b.x);
                // randomly pick one extreme point to be the spawn and the other to be the despawn
                let spawn: Vector2, despawn: Vector2;
                if (Math.random() < 0.5) {
                    spawn = pointsOfInterest[0];
                    despawn = pointsOfInterest[pointsOfInterest.length - 1];
                } else {
                    spawn = pointsOfInterest[pointsOfInterest.length - 1];
                    despawn = pointsOfInterest[0];
                }
                // if the spawn is beyond the clip distance, move it inward
                spawn.x = Math.max(spawn.x, 0 - CLIP_DISTANCE);
                spawn.x = Math.min(spawn.x, this.xmax + CLIP_DISTANCE);
                spawn.y = Math.max(spawn.y, 0 - CLIP_DISTANCE);
                spawn.y = Math.min(spawn.y, this.ymax + CLIP_DISTANCE);
                // respawn the rover
                rover.location = new Vector2(spawn.x, spawn.y);
                rover.spawn = spawn;
                rover.despawn = despawn;
            }

            // move the rover along its path
            // total x and y distance the rover needs to travel
            const dTotal = rover.despawn.minus(rover.spawn);
            const angle = Math.atan(dTotal.y / dTotal.x);
            // distance to travel this frame
            const distanceThisFrame = (rover.speed * timeElapsedMs) / 1000;
            const d = new Vector2(
                distanceThisFrame * Math.cos(angle),
                distanceThisFrame * Math.sin(angle)
            );
            // apply location transform
            rover.location = rover.location.plus(d);

            // update delaunay input in-place
            const offset = 2 * (this.fixedPoints.length + index);
            this.delaunayInput[offset] = rover.location.x;
            this.delaunayInput[offset + 1] = rover.location.y;
        });

        // render rovers and cells
        // update the voronoi diagram
        this.voronoi.update();
        const context = this.context;

        // refresh buffers
        const cellPolygons = Array.from(this.voronoi.cellPolygons());
        this.refreshBuffers(cellPolygons);

        // clear canvas

        // draw - since each polygon has a different number of vertices,
        // we need to iterate over them and make a separate draw call for each
        context.bindBuffer(
            context.ARRAY_BUFFER,
            this.programInfo.buffers.position
        );
        let offset = 0;
        cellPolygons.forEach((cell) => {
            const vertexCount = cell.length - 1; // first vertex is a duplicate of the last and is ignored
            context.drawArrays(context.TRIANGLE_FAN, offset, vertexCount);
            offset += vertexCount;
        });

        // sleep
        if (!once) {
            setTimeout(() => {
                this.loop();
            }, 1000 / TARGET_FPS);
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

class Rover extends Point {
    spawn: Vector2 | null;
    despawn: Vector2 | null;
    speed: number;

    constructor(
        location: Vector2,
        spawn: Vector2 | null,
        despawn: Vector2 | null,
        speed: number = 100,
        color: d3.RGBColor
    ) {
        super(location, color);
        this.spawn = spawn;
        this.despawn = despawn;
        this.speed = speed;
    }
}

type Polygon = [x: number, y: number][];

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

    static randomDark(): d3.RGBColor {
        const h = Math.random() * 90;
        const s = Math.random() * 0.2 + 0.2;
        const v = Math.random() * 0.2;
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
    const [width, setWidth] = useState<number>(window.innerWidth);
    const [height, setHeight] = useState<number>(window.innerHeight);
    const [board, setBoard] = useState<GameBoard>();

    const canvasRef = useRef<HTMLCanvasElement>(null);

    const App = document.getElementById('App');
    console.debug({ App });
    if (App && (width !== App.clientWidth || height !== App.clientHeight)) {
        setWidth(App.clientWidth);
        setHeight(App.clientHeight);
    }

    useEffect(() => {
        const canvas = canvasRef.current as HTMLCanvasElement;
        const context = canvas.getContext('webgl2') as WebGL2RenderingContext;
        setBoard((oldBoard) => {
            if (oldBoard) {
                oldBoard.stop();
            }
            const newBoard = new GameBoard(context, 30, width, height, 0, 0);
            newBoard.loop(true);
            return newBoard;
        });
    }, [width, height]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            id="voronoiRoverCanvas"
        />
    );
};
