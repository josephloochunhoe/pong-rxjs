import { interval, fromEvent, from, zip } from 'rxjs'
import { map, scan, filter, merge, flatMap, takeUntil, take, concat} from 'rxjs/operators'

const
	Constants = new class {
		readonly CanvasSize = 600
		readonly PaddleXPosition = 50
		readonly PaddleYPosition = 285
		readonly PaddleWidth = 7
		readonly PaddleHeight = 30
		readonly PaddleVelocity = 3
		// readonly PaddleAcc = 1
		// readonly BallRadius = 4
		readonly BallSize = 7
		readonly BallVelocity = 3
		readonly MaxScore = 7
	}

type Key = 'ArrowUp' | 'ArrowDown'
type Event = 'keyup' | 'keydown'
type ViewType = 'paddle' | 'ball'
type Role = 'player' | 'enemy' | 'ball'

function pong() {
    // This code is heavily inspired by the code from https://tgdwyer.github.io/asteroids/. 

	class Tick { constructor(public readonly elapsed: number) {} }
	class Move { constructor(public readonly direction: Key) {} }
	
	const 
		keyObservable = <T>(e: Event, k: Key, result: () => T) =>
    	fromEvent<KeyboardEvent>(document, e).pipe(
			filter(({code}) => code === k),
			filter(({repeat}) => !repeat),
			map(result)
		),

		startUp = keyObservable('keydown', 'ArrowUp', () => new Move("ArrowUp")),
		stopUp = keyObservable('keyup', 'ArrowUp', () => new Move("ArrowUp")), 
		startDown = keyObservable('keydown', 'ArrowDown', () => new Move("ArrowDown")),
		stopDown = keyObservable('keyup', 'ArrowDown', () => new Move("ArrowDown"))
	
	type Body = Readonly<{
		id: string,
		viewType: ViewType,
		width: number,
		height: number,
		pos: Vec, 
		vel: Vec,
		acc: Vec,
		angle: number
	}>

	type State = Readonly<{
		time: number,
		player: Body,
		enemy: Body,
		ball: Body,
		playerScore: number,
		enemyScore: number,
		exit: ReadonlyArray<Body>,
		gameOver: boolean
	}>

	const 
		createRectangle = (id: Role) => (viewType: ViewType) => 
						  (width: number) => (height: number) => 
						  (pos: Vec) => 
						  (vel: Vec) => (acc: Vec) => 
		<Body>{
			id: id,
			viewType: viewType,
			width: width,
			height: height,
			pos: pos, 
			vel: vel,
			acc: acc,
			angle: 0
		}

	const
		player = createRectangle ('player') ('paddle') 
								 (Constants.PaddleWidth) (Constants.PaddleHeight) 
								 (new Vec(Constants.PaddleXPosition, Constants.PaddleYPosition)) 
								 (Vec.Zero) (Vec.Zero),

		enemy = createRectangle ('enemy') ('paddle') 
								(Constants.PaddleWidth) (Constants.PaddleHeight) 
								(new Vec(Constants.CanvasSize - Constants.PaddleXPosition - Constants.PaddleWidth, Constants.PaddleYPosition)) 
								(new Vec(0, -Constants.PaddleVelocity)) (Vec.Zero),

		startBall = createRectangle('ball') ('ball') 
								   (Constants.BallSize) (Constants.BallSize) 
								   (new Vec(Constants.CanvasSize / 2, Constants.CanvasSize / 2)) 
								   (new Vec(Math.random() * 2 - 1, Math.random() * 2 - 1).scale(Constants.BallVelocity)) (Vec.Zero),
								//    (new Vec(0, -Constants.BallVelocity)) (Vec.Zero),

		initialState: State = {
			time: 0,
			player: player,
			enemy: enemy,
			ball: startBall,
			playerScore: 0,
			enemyScore: 0,
			exit: [],
			gameOver: false
		},
		
		moveObj = (o: Body): Body => {
			// const 
			// 	updatedPos = o.pos.add(o.vel),
			// 	outOfBounds = updatedPos.y <= 0 || updatedPos.y >= Constants.CanvasSize
		return <Body>{
			...o,
			// pos: outOfBounds ? o.pos : updatedPos
			pos: o.pos.add(o.vel)
		}},
		handleCollisions = (s: State) => {
			const
				bodiesCollided = (a: Body, b: Body) => (a.pos.x + a.width >= b.pos.x) && 
													   (a.pos.x <= b.pos.x + b.width) &&
													   (a.pos.y + a.height >= b.pos.y) && 
													   (a.pos.y <= b.pos.y + b.height),
				ballCollidePlayer = bodiesCollided(s.ball, s.player),
				ballCollideEnemy = bodiesCollided(s.enemy, s.ball),
				ballCollideWall = s.ball.pos.y <= 0 || s.ball.pos.y >= Constants.CanvasSize,
				ballReboundPaddle = (ball: Body, paddle: Body): Body => 
														{return ball.pos.y <= paddle.pos.y + (Constants.PaddleHeight/2) ? 
															<Body>{...ball, vel: ball.vel.scale(-1)} : // Top half of paddle: the ball moves backwards to previous direction
															<Body>{...ball, vel: ball.vel.ortho()}}, // Bottom half of paddle: the ball moves orthogonal to previous direction

				ballRebound = (s: State): Body => 
											{return ballCollidePlayer ? 
												ballReboundPaddle(s.ball, s.player) :
											ballCollideEnemy ? 
												ballReboundPaddle(s.ball, s.enemy) :
											ballCollideWall ? 
												<Body>{...s.ball, vel: s.ball.vel.ortho()} : 
											<Body>{...s.ball}},  // Return the ball at the same state if no collision

				newBallState = ballRebound(s)

			return <State>{
				...s,
				ball: newBallState
      		}
		},
		handleScoring = (s: State): State => {
			const
				enemyScored = s.ball.pos.x < 0,
				playerScored = s.ball.pos.x > Constants.CanvasSize,
				playerWon = playerScored ? s.playerScore + 1 > Constants.MaxScore : false,
				enemyWon = enemyScored ? s.enemyScore + 1 > Constants.MaxScore : false

			return playerScored ? <State>{...s, playerScore: s.playerScore + 1, exit: s.exit.concat(s.ball), gameOver: playerWon} : 
					enemyScored ? <State>{...s, enemyScore: s.enemyScore + 1, exit: s.exit.concat(s.ball), gameOver: enemyWon} : 
								  <State>{...s}
		},
		tick = (s: State, elapsed: number) => {
			return handleScoring(handleCollisions(
				{
					...s, 
					time: elapsed,
					enemy: moveObj(s.enemy),
					ball: moveObj(s.ball)
				}
			))
		},
		reduceState = (s: State, e: Move | Tick) => 
			e instanceof Move ? {...s,
				player: {...s.player, vel: e.direction === 'ArrowUp' ? new Vec (0, Constants.PaddleVelocity).scale(-1) 
																	 : new Vec (0, Constants.PaddleVelocity)}
			} :
			tick(s, e.elapsed)
		
		const subscription = interval(10).pipe(
			map(elapsed => new Tick(elapsed)),
			merge(startUp, startDown, stopUp, stopDown),
			scan(reduceState, initialState)).
			subscribe(updateView)
		
	function updateView(s: State) {
		const 
			svg = document.getElementById("canvas")!,
			player = document.getElementById("player_paddle")!,
			enemy = document.getElementById("enemy_paddle")!,
			player_score = document.getElementById("player_score")!,
			enemy_score = document.getElementById("enemy_score")!,
			attr = (e: Element, o: any) =>
				{ for(const k in o) e.setAttribute(k, String(o[k])) },
			updateBallView = (b:Body) => {
				const createBallView = () => {
					const v = document.createElementNS(svg.namespaceURI, "rect")!
					attr(v, {id: b.id, x: Constants.CanvasSize / 2, y: Constants.CanvasSize / 2})
					v.classList.add(b.viewType)
					svg.appendChild(v)
					return v
				}
				const v = document.getElementById(b.id) || createBallView();
				attr(v, {x: b.pos.x, y: b.pos.y})
			};
		
		// Update each of the UI elements to the new values
		// Update the movement of the paddles
		attr(player, {y:`${s.player.pos.y}`})
		attr(enemy, {y:`${s.enemy.pos.y}`})
		
		// Remove the ball that has been scored
		s.exit.map(o => document.getElementById(o.id))
				.filter(isNotNullOrUndefined)
				.forEach(v => svg.removeChild(v))
		
		// Add the ball for next round or update the ball's position if still in play
		updateBallView(s.ball)

		// Update the score if any players has scored
		player_score.textContent = String(s.playerScore)
		enemy_score.textContent = String(s.enemyScore)


		if (s.gameOver) {
			subscription.unsubscribe()
			const v = document.createElementNS(svg.namespaceURI, "text")!
			attr(v, {x: Constants.CanvasSize/6, y: Constants.CanvasSize/2, class: "end_message"})
			s.playerScore > 7 ? v.textContent = "Player Won": v.textContent = "Computer Won"
			svg.appendChild(v)
		}
	}
}

function showKeys() {
	function showKey(keyCode: Key) {
		const 
			arrowKey = document.getElementById(keyCode)!,
			keyObservable = (e:Event) => 
				fromEvent<KeyboardEvent>(document, e).pipe(filter(({code}) => code === keyCode))
			

		keyObservable('keydown').subscribe(_ => arrowKey.classList.add("highlight"))
		keyObservable('keyup').subscribe(_ => arrowKey.classList.remove("highlight"))
		
	}
	showKey("ArrowUp")
	showKey("ArrowDown")
  }

// the following simply runs your pong function on window load.  Make sure to leave it in place.
if (typeof window != 'undefined')
	window.onload = ()=>{
		pong();
		showKeys();
	}	

class Vec {
	constructor(public readonly x: number = 0, public readonly y: number = 0) {}
	add = (b:Vec) => new Vec(this.x + b.x, this.y + b.y)
	sub = (b:Vec) => this.add(b.scale(-1))
	len = ()=> Math.sqrt(this.x*this.x + this.y*this.y)
	scale = (s:number) => new Vec(this.x*s,this.y*s)
	ortho = ()=> new Vec(this.y,-this.x)
	rotate = (deg:number) =>
            (rad =>(
                (cos,sin,{x,y})=>new Vec(x*cos - y*sin, x*sin + y*cos)
              )(Math.cos(rad), Math.sin(rad), this)
            )(Math.PI * deg / 180)

  static unitVecInDirection = (deg: number) => new Vec(0,-1).rotate(deg)
	
	static Zero = new Vec();
}
  
/**
 * Type guard for use in filters
 * @param input something that might be null or undefined
 */
function isNotNullOrUndefined<T extends Object>(input: null | undefined | T): input is T {
	return input != null;
  }

  
	// createBall = ():Body => {
	// 	return {
	// 		id: 'ball',
	// 		viewType: 'ball',
	// 		pos: new Vec(Constants.CanvasSize/2, Constants.CanvasSize/2), 
	// 		vel: Vec.Zero,
	// 		acc: Vec.Zero,
	// 		angle: 0,
	// 		radius: Constants.BallRadius
	// 	}
	// },
	// createPaddle = (role: Role): Body => {
	// 	return {
	// 		id: role,
	// 		viewType: 'paddle',
	// 		pos: role === 'player' ? new Vec(Constants.PaddleXPosition, Constants.CanvasSize/2) : new Vec(Constants.CanvasSize - Constants.PaddleXPosition, Constants.CanvasSize/2),
	// 		vel: Vec.Zero,
	// 		acc: Vec.Zero,
	// 		angle: 0,
	// 		radius: 0
	// 	}
	// },
	
	// const 
	// 	svg = document.getElementById("canvas"),
	// 	player = document.getElementById("player_paddle"),
	// 	enemy = document.getElementById("enemy_paddle"),
	// 	keydown$ = fromEvent<KeyboardEvent>(document, 'keydown'),
	
	// // Function to update the y attribute of the paddle
	// moveY = (paddle: Element, unit: number) => () => {
	// 	const newY = Number(player.getAttribute('y')) + unit
	// 	if (newY < Number(svg.getAttribute('height'))-30 && newY > 0) {
	// 		paddle.setAttribute('y', String(newY))
	// 	}
	// }
	// Creating observable stream to handle movement of paddle
	// const keyObservable = function() {
	// 	return (code: Key, f: () => void) => keydown$.pipe(
	// 		filter(({repeat}) => !repeat),
	// 		filter(({key}) => key === code),
	// 		flatMap(d => interval(10).pipe(
	// 			takeUntil(fromEvent<KeyboardEvent>(document, 'keyup').pipe(
	// 				filter(({key})=>key === code)
	// 			)),
	// 			map(_=>d))
	// 		),
	// 		map(_=>f)
	// 	)
	// }(),

	// Creating observable stream specific to up and down movements of paddle
	// startUp = keyObservable('keydown', 'ArrowUp', moveY(player, -3)), 
	// stopUp = keyObservable('keyup', 'ArrowUp', moveY(player, -3)), 
	// startDown = keyObservable('keydown', 'ArrowDown', moveY(player, 3)),
	// stopDown = keyObservable('keyup', 'ArrowDown', moveY(player, 3)),

	// Merge the streams to be subscribed
	// mergedKeyObservable = up.pipe(merge(down))
	// mergedKeyObservable.subscribe(f => f())