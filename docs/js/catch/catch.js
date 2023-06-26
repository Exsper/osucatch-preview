function Catch(osu, mods) {
    Beatmap.call(this, osu, mods);

    let savedDefaultColor = window.localStorage.getItem("DefaultColor");
    this.useDefaultColor = (savedDefaultColor) ? parseInt(savedDefaultColor) : 0;

    let savedColorChange = window.localStorage.getItem("ColorChange");
    this.colorChange = (savedColorChange) ? parseInt(savedColorChange) : 0;

    let savedWhiteBanana = window.localStorage.getItem("WhiteBanana");
    this.whiteBanana = (savedWhiteBanana) ? parseInt(savedWhiteBanana) : 0;

    if (this.Colors.length && !this.useDefaultColor) {
        this.Colors.push(this.Colors.shift());
    }
    else {
        this.Colors = Catch.DEFAULT_COLORS;
    }

    this.circleRadius = this.circleDiameter / 2 - 4;
    this.smallRadius = this.circleRadius / 2;
    this.tinyRadius = this.smallRadius / 2;
    this.bananaRadius = this.circleRadius * 0.8;

    this.CATCHER_HEIGHT = Beatmap.HEIGHT / 8;
    this.FALLOUT_TIME = (this.CATCHER_HEIGHT / Beatmap.HEIGHT) * this.approachTime;

    var combo = 1,
        comboIndex = -1,
        setComboIndex = 1;
    for (var i = 0; i < this.HitObjects.length; i++) {
        let hitObject = this.HitObjects[i];
        if (hitObject instanceof BananaShower) {
            setComboIndex = 1;
        }
        else if (hitObject.newCombo || setComboIndex) {
            combo = 1;
            comboIndex = ((comboIndex + 1) + hitObject.comboSkip) % this.Colors.length;
            setComboIndex = 0;
        }
        hitObject.combo = combo++;
        hitObject.color = (this.colorChange) ? this.Colors[i % this.Colors.length] : this.Colors[comboIndex];

        if (hitObject instanceof JuiceStream || hitObject instanceof BananaShower) {
            hitObject.buildNested();
        }
    }

    this.CATCHER_BASE_SIZE = 106.75;
    this.ALLOWED_CATCH_RANGE = 0.8;
    this.HYPER_DASH_TRANSITION_DURATION = 180;
    this.calculateScale = 1.0 - 0.7 * (this.CircleSize - 5) / 5;
    this.catchWidth = this.CATCHER_BASE_SIZE * Math.abs(this.calculateScale) * this.ALLOWED_CATCH_RANGE;
    this.halfCatcherWidth = this.catchWidth / 2;
    this.halfCatcherWidth /= this.ALLOWED_CATCH_RANGE;
    this.BASE_DASH_SPEED = 1;
    this.BASE_WALK_SPEED = 0.5;

    // sliders & spins xoffset
    this.RNG_SEED = 1337;
    var rng = new LegacyRandom(this.RNG_SEED);

    let lastPosition = null;
    let lastStartTime = 0;

    for (var i = 0; i < this.HitObjects.length; i++) {
        let hitObject = this.HitObjects[i];
        // console.log(hitObject.nested)
        if (hitObject instanceof Fruit) {
            if (mods.HR) {
                let offsetPosition = hitObject.position.x;
                let startTime = hitObject.time;
                if (lastPosition == null) {
                    lastPosition = offsetPosition;
                    lastStartTime = startTime;
                    continue;
                }
                let positionDiff = offsetPosition - lastPosition;
                // Todo: BUG!! Stable calculated time deltas as ints, which affects randomisation. This should be changed to a double.
                let timeDiff = parseInt(startTime - lastStartTime);
                if (timeDiff > 1000) {
                    lastPosition = offsetPosition;
                    lastStartTime = startTime;
                    continue;
                }
                if (positionDiff == 0) {
                    let right = rng.NextBool();
                    let rand = Math.min(20, rng.Next(0, Math.max(0, timeDiff / 4)));
                    if (right) {
                        // Clamp to the right bound
                        if (offsetPosition + rand <= Beatmap.MAX_X) offsetPosition += rand;
                        else offsetPosition -= rand;
                    }
                    else {
                        // Clamp to the left bound
                        if (offsetPosition - rand >= 0) offsetPosition -= rand;
                        else offsetPosition += rand;
                    }
                    hitObject.position.x = offsetPosition;
                    continue;
                }
                // ReSharper disable once PossibleLossOfFraction
                if (Math.abs(positionDiff) < timeDiff / 3)
                    if (positionDiff > 0) {
                        // Clamp to the right bound
                        if (offsetPosition + positionDiff < Beatmap.MAX_X) offsetPosition += positionDiff;
                    }
                    else {
                        // Clamp to the left bound
                        if (offsetPosition + positionDiff > 0) offsetPosition += positionDiff;
                    }

                hitObject.position.x = offsetPosition;

                lastPosition = offsetPosition;
                lastStartTime = startTime;
            }
        }

        else if (hitObject instanceof BananaShower) {
            hitObject.nested.forEach(banana => {
                banana.x += (rng.NextDouble() * Beatmap.MAX_X);
                rng.Next(); // osu!stable retrieved a random banana type
                rng.Next(); // osu!stable retrieved a random banana rotation
                rng.Next(); // osu!stable retrieved a random banana colour
            });
        }
        else if (hitObject instanceof JuiceStream) {
            // Todo: BUG!! Stable used the last control point as the final position of the path, but it should use the computed path instead.
            lastPosition = hitObject.points[hitObject.points.length - 1].x;
            // Todo: BUG!! Stable attempted to use the end time of the stream, but referenced it too early in execution and used the start time instead.
            lastStartTime = hitObject.time;
            hitObject.nested.forEach(item => {
                if (item.type === "TinyDroplet") item.x += Math.clamp(rng.Next(-20, 20), -item.x, Beatmap.MAX_X - item.x);
                else if (item.type === "Droplet") rng.Next(); // osu!stable retrieved a random droplet rotation
            });
        }
    }

    // catch objects
    this.palpableObjects = [];
    this.fullCatchObjects = [];

    for (var i = 0; i < this.HitObjects.length; i++) {
        let hitObject = this.HitObjects[i];
        if (hitObject instanceof Fruit) {
            let pch = new PalpableCatchHitObject({
                type: "Fruit",
                time: hitObject.time,
                x: hitObject.position.x,
                color: hitObject.color,
                radius: this.circleRadius,
            }, this);

            this.palpableObjects.push(pch);
            this.fullCatchObjects.push(pch);
        }
        else if (hitObject instanceof BananaShower) {
            if (this.whiteBanana) {
                // 计算香蕉最佳路径
                let bananas = hitObject.nested;
                // 考虑到spin一般为孤立的，不考虑spin前后物件
                // let start = null;
                // if (this.fullCatchObjects.length > 0) start = this.fullCatchObjects[this.fullCatchObjects.length - 1];
                // let end = null;
                // 计算最长路径
                // 设开始节点为start，通向包含end的所有节点，路径赋值均为1
                // 设结束节点为end，连接包含start的所有节点，路径赋值均为1
                // 香蕉索引为1-n，开始节点索引为0，结束节点索引为n+1
                let n = bananas.length;
                let G = [];
                let dp = []
                let choice = [];
                // 初始化
                for (let ni = 0; ni <= n + 1; ni++) {
                    G[ni] = [];
                    choice[ni] = -1;
                    dp[ni] = -1;
                }
                // 开始
                for (let ni = 1; ni <= n + 1; ni++) {
                    G[0][ni] = 1;
                }
                // 结束
                for (let ni = 0; ni <= n; ni++) {
                    G[ni][n + 1] = 1;
                }
                // 香蕉间
                for (let ni = 1; ni <= n; ni++) {
                    for (let nj = ni + 1; nj <= n; nj++) {
                        // if 香蕉间的距离<=盘子速度*间隔时间 + 1/2 * 盘子大小  路径赋值1
                        // else if 香蕉间的距离<=盘子速度*间隔时间 + 盘子大小  路径赋值 (盘子速度*间隔时间 + 盘子大小 - 香蕉间的距离) / (1/2 * 盘子大小)
                        // else if 香蕉间的距离>盘子速度*间隔时间 + 盘子大小  断路
                        let bspace = Math.abs(bananas[ni - 1].x - bananas[nj - 1].x);
                        let btime = bananas[nj - 1].time - bananas[ni - 1].time - 1000 / 60 / 4;
                        if (bspace <= btime * this.BASE_WALK_SPEED + this.halfCatcherWidth) G[ni][nj] = 1;
                        else if (bspace <= btime * this.BASE_WALK_SPEED + this.catchWidth) G[ni][nj] = ((btime * this.BASE_WALK_SPEED + this.catchWidth - bspace) / this.halfCatcherWidth) / 2 + 0.5;
                        else if (bspace <= btime * this.BASE_DASH_SPEED + this.halfCatcherWidth) G[ni][nj] = 0.5;
                        else if (bspace <= btime * this.BASE_DASH_SPEED + this.catchWidth) G[ni][nj] = (btime * this.BASE_DASH_SPEED + this.catchWidth - bspace) / this.halfCatcherWidth / 2;

                    }
                }
                function DP(ni) {
                    if (dp[ni] > 0) return dp[ni];
                    for (let nj = ni + 1; nj <= n + 1; nj++) {
                        if (G[ni][nj] && G[ni][nj] > 0) {
                            let temp = DP(nj) + G[ni][nj];
                            if (temp > dp[ni]) {
                                dp[ni] = temp;
                                choice[ni] = nj;
                            }
                        }
                    }
                    return dp[ni];
                }
                let maxdp = DP(0);
                // console.log(choice)
                // 最优节点涂上白色
                let ni = 0;
                while (ni <= (n + 1) && (choice[ni]) != -1) {
                    ni = choice[ni];
                    if ((ni - 1) < n) bananas[ni - 1].color = 'rgb(255,255,255)';
                }
            }

            hitObject.nested.forEach(banana => {
                this.fullCatchObjects.push(banana);
            });
        }
        else if (hitObject instanceof JuiceStream) {
            hitObject.nested.forEach(item => {
                this.fullCatchObjects.push(item);
                if (item.type != "TinyDroplet") this.palpableObjects.push(item);
            });
        }
    }
    this.palpableObjects.sort((a, b) => a.time - b.time);
    this.fullCatchObjects.sort((a, b) => a.time - b.time);


    //this.whiteDashes = [];
    //this.hyperDashes = [];

    // hyperdash
    let lastDirection = 0;
    let lastExcess = this.halfCatcherWidth;

    for (let i = 0; i < this.palpableObjects.length - 1; i++) {
        var currentObject = this.palpableObjects[i];
        var nextObject = this.palpableObjects[i + 1];

        currentObject.hyperDash = false;

        let thisDirection = nextObject.x > currentObject.x ? 1 : -1;
        let timeToNext = nextObject.time - currentObject.time - 1000 / 60 / 4; // 1/4th of a frame of grace time, taken from osu-stable
        let distanceToNext = Math.abs(nextObject.x - currentObject.x) - (lastDirection == thisDirection ? lastExcess : this.halfCatcherWidth);
        let distanceToHyper = timeToNext * this.BASE_DASH_SPEED - distanceToNext;

        if (distanceToHyper < 0) {
            currentObject.hyperDash = true;
            lastExcess = this.halfCatcherWidth;
            //this.hyperDashes.push({ score: distanceToHyper, time: currentObject.time });
        }
        else {
            lastExcess = Math.clamp(distanceToHyper, 0, this.halfCatcherWidth);
            //this.whiteDashes.push({ score: distanceToHyper, time: currentObject.time });
        }

        lastDirection = thisDirection;
    }

    //this.whiteDashes.sort((a, b) => a.score - b.score);
    //this.hyperDashes.sort((a, b) => a.score - b.score);

    //console.log(this.whiteDashes)
    //console.log(this.hyperDashes)


}
Catch.prototype = Object.create(Beatmap.prototype, {
    approachTime: { // droptime
        get: function () {
            return this.ApproachRate < 5
                ? 1800 - this.ApproachRate * 120
                : 1200 - (this.ApproachRate - 5) * 150;
        }
    },
    // https://github.com/itdelatrisu/opsu/commit/8892973d98e04ebaa6656fe2a23749e61a122705
    circleDiameter: {
        get: function () {
            return 108.848 - this.CircleSize * 8.9646;
        }
    }
});
Catch.prototype.constructor = Catch;
Catch.prototype.hitObjectTypes = {};
Catch.DEFAULT_COLORS = [
    'rgb(255,210,128)',
    'rgb(128,255,128)',
    'rgb(128,191,255)',
    'rgb(191,128,255)'
];
Catch.prototype.update = function (ctx) {
    ctx.translate((Beatmap.WIDTH - Beatmap.MAX_X) / 2, (Beatmap.HEIGHT - Beatmap.MAX_Y) / 2);
};
Catch.prototype.draw = function (time, ctx) {
    if (typeof this.tmp.first == 'undefined') {
        this.tmp.first = 0;
        this.tmp.last = -1;
    }

    while (this.tmp.first < this.fullCatchObjects.length) {
        var catchHitObject = this.fullCatchObjects[this.tmp.first];
        if (time <= catchHitObject.time + this.FALLOUT_TIME) {
            break;
        }
        this.tmp.first++;
    }
    while (this.tmp.last + 1 < this.fullCatchObjects.length &&
        time >= this.fullCatchObjects[this.tmp.last + 1].time - this.approachTime * 1.1) {
        this.tmp.last++;
    }
    for (var i = this.tmp.last; i >= this.tmp.first; i--) {
        var catchHitObject = this.fullCatchObjects[i];
        if (time > catchHitObject.time + this.FALLOUT_TIME) {
            continue;
        }
        catchHitObject.draw(time, ctx);
    }
};
Catch.prototype.processBG = function (ctx) {
    // line
    ctx.beginPath();
    ctx.moveTo(0, Beatmap.HEIGHT - this.CATCHER_HEIGHT);
    ctx.lineTo(Beatmap.WIDTH, Beatmap.HEIGHT - this.CATCHER_HEIGHT);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    // plate
    let plateHeight = this.catchWidth / 60;
    ctx.beginPath();
    ctx.rect(Beatmap.WIDTH / 2 - this.catchWidth / 2, Beatmap.HEIGHT - this.CATCHER_HEIGHT - plateHeight / 2, this.catchWidth, plateHeight);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fill();
};

Catch.prototype.processProgressBar = function (ctx, totalTime) {
    
    ctx.fillStyle = '#fce331';
    let ctxheight = ctx.canvas.height;
    let ctxwidth = ctx.canvas.width;
    for (var i = 0; i < this.HitObjects.length; i++) {
        let hitObject = this.HitObjects[i];
        if (hitObject instanceof BananaShower) {
            let time = hitObject.time;
            let endtime = hitObject.endTime;
            ctx.fillRect(ctxwidth * time / totalTime, 0, ctxwidth * (endtime - time) / totalTime, ctxheight);
        }
    }
};