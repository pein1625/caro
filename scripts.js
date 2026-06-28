$(function () {
    'use strict';

    var ksh_send_input_string = null;
    var ksh_get_output_string = null;

    // === VARS ===
    var board_size = 15;
    var board, board_update_defer, board_history;
    var move_cnt = 0;
    var undo_remain = 0;
    var cur_reply_cnt = 0;
    // END VARS

    // === OBJECTS ===
    var game_status = $('#game_status');
    var panel_status = $('#panel_status');
    var btn_start = $('#btn_start').click(start_game);
    var btn_restart = $('#btn_restart').click(restart_game);
    var btn_undo = $('#btn_undo').click(undo_game);
    var ai_logs = document.getElementById('ai_logs');
    var btn_showmoves = $('#btn_showmoves').click(game_showmoves);
    var btn_prevmove = $('#btn_prevmove').click(game_prevmove);
    var btn_nextmove = $('#btn_nextmove').click(game_nextmove);
    var panel_gamearea = document.getElementById('panel_gamearea');
    var lbl_cols = document.getElementById('lbl_cols');
    var lbl_rows = document.getElementById('lbl_rows');
    var ai_msg = $('#ai_msg');
    var div_pb_outer = $('#div_pb_outer');    // Progress bar
    var div_pb_inner = $('#div_pb_inner');
    // END OBJECTS

    // === SOCKET ===
    function on_loaded_wasm() {
        Module._ksh_start();
        ksh_send_input_string = Module.cwrap('ksh_send_input', null, ['string']);
        ksh_get_output_string = Module.cwrap('ksh_get_output', 'string', null);

        btn_start.prop('disabled', false);
        $('#btn_download_logs').show();
        update_ws_status('Connected', '#00c853');

        setInterval(function () {
            var output = ksh_get_output_string();
            if (output.length === 0) {
                return;
            }
            var cmd = output.split(' ');
            switch (cmd[0]) {
                case 'START':
                    server_start();
                    break;
                case 'AI':
                    server_ai_turn(parseInt(cmd[1]), parseInt(cmd[2]));
                    break;
                case 'HM':
                    server_human_turn(parseInt(cmd[1]), parseInt(cmd[2]));
                    break;
                case 'WIN':
                    server_win(cmd);
                    break;
                case 'UNDO':
                    server_undo(parseInt(cmd[1]), parseInt(cmd[2]),
                        parseInt(cmd[3]), parseInt(cmd[4]),
                        parseInt(cmd[5]), parseInt(cmd[6]));
                    break;
                case 'UNDOR':
                    server_undo_remain(parseInt(cmd[1]));
                    break;
                case 'STT':
                    server_stt(output.substr(4));
                    break;
                case 'PB':
                    server_progress(parseInt(cmd[1]));
                    break;
                case 'L':
                    server_log(output.substr(2));
                    break;
                case 'MSG':
                    server_msg(output.substr(4));
                    break;
                case 'LOGCLR':
                    ai_logs.value = '';
                    ai_msg.text('');
                    break;
            }
        }, 25);
    };
    if (window.ksh_loaded_wasm) {
        on_loaded_wasm();
    } else {
        window.ksh_on_loaded_wasm = on_loaded_wasm;
    }

    function draw_empty_board() {
        board = []; board_update_defer = []; board_history = [];
        move_cnt = 0;
        for (var i = 0; i < board_size; i++) {
            board.push([]);
            for (var j = 0; j < board_size; j++)
                board[i].push({ empty: true });
        }
        init_board();
        render_board(null, null, true);
    }

    function server_start() {
        set_panel_state(true);
        btn_start.prop('disabled', false);
        btn_restart.prop('disabled', false);
        btn_undo.prop('disabled', false);
        btn_showmoves.hide(0); btn_prevmove.hide(0); btn_nextmove.hide(0);

        draw_empty_board();
        panel_gamearea.classList.add('started');
        tbl_board.classList.add('playing');
        tbl_board.classList.remove('thinking');
        set_options_enabled(false);
    }

    function set_options_enabled(enabled) {
        $('input[name="ai-select"], input[name="ai-level"], input[name="play-first"]')
            .prop('disabled', !enabled);
    }

    function new_piece(x, y, p, no) {
        render_board([{
            x: x, y: y, change: {
                empty: false,
                piece: p,
                new_move: true,
                move_num: no
            }
        }], [{
            x: x, y: y, change: {
                new_move: false
            }
        }]);
        board_history.push({ x: x, y: y, piece: p });
    }

    function server_ai_turn(x, y) {
        new_piece(x, y, 1, ++move_cnt);
    }
    function server_human_turn(x, y) {
        new_piece(x, y, 2, ++move_cnt);
    }
    function server_stt(stt) {
        game_status.text(stt);
    }
    var progress_on = false;
    function server_progress(time) {
        div_pb_inner.stop();
        tbl_board.classList.toggle('thinking', time > 0);
        if (time > 0) {
            progress_on = true;
            btn_restart.prop('disabled', true);
            btn_undo.prop('disabled', true);
            div_pb_inner.width('0%');
            div_pb_inner.attr('aria-valuenow', 0);
            div_pb_outer.animate({ 'opacity': 1 }, { duration: 300, queue: false });
            div_pb_inner.animate({ 'width': '100%', 'aria-valuenow': 100 }, { duration: time, easing: 'linear', queue: false });
        } else {
            progress_on = false;
            btn_restart.prop('disabled', false);
            if (undo_remain > 0) btn_undo.prop('disabled', false);
            div_pb_inner.animate({ 'width': '100%', 'aria-valuenow': 100 }, { duration: 250, queue: false });
            div_pb_outer.animate({ 'opacity': 0 }, { duration: 300, queue: false });
        }
    }
    function server_log(log) {
        ai_logs.value = log + '\r\n' + ai_logs.value;
    }
    function server_msg(msg) {
        ai_msg.text(msg);
    }
    function server_undo_remain(remain) {
        undo_remain = remain;
        btn_undo.text('Undo (' + remain + ')');
        btn_undo.prop('disabled', remain === 0);
    }
    function server_undo(x1, y1, x2, y2, xlast, ylast) {
        var up = [], defer = [];
        if (x1 !== -1 && y1 !== -1) {
            up.push({ x: x1, y: y1, change: { empty: true, undo_move: true } });
            defer.push({ x: x1, y: y1, change: { undo_move: false } });
        }
        if (x2 !== -1 && y2 !== -1) {
            up.push({ x: x2, y: y2, change: { empty: true, undo_move: true } });
            defer.push({ x: x2, y: y2, change: { undo_move: false } });
        }
        if (xlast !== -1 && ylast !== -1) {
            up.push({ x: xlast, y: ylast, change: { new_move: true } });
            defer.push({ x: xlast, y: ylast, change: { new_move: false } });
        }
        render_board(up, defer);
    }
    function server_win(cmd) {
        cmd = cmd.map(function (x) { return parseInt(x); });
        //console.log(cmd);
        var up = [], defer = [];
        for (var i = 1; i < 10; i += 2) {
            up.push({ x: cmd[i], y: cmd[i + 1], change: { win_move: true } });
            defer.push({ x: cmd[i], y: cmd[i + 1], change: { win_move: false } });
        }
        btn_undo.prop('disabled', true);
        tbl_board.classList.remove('playing', 'thinking');
        render_board(up, defer);
        btn_showmoves.show(200);
    }

    function update_ws_status(status, statusColor) {
        $('.ws_indicator, .ws_status').show(0);
        $('.ws_indicator').css('background-color', statusColor);
        $('.ws_status').text(status);
    }

    function socket_send(msg) {
        //console.log("client: " + msg);
        if (!progress_on)
            ksh_send_input_string(msg);
    }
    // END SOCKET

    // === GAME ===
    function start_game() {
        btn_start.prop('disabled', true);
        ai_logs.value = '';
        var variant = $('input[name="ai-select"]:checked').val();
        var level = $('input[name="ai-level"]:checked').val();
        var pf = $('input[name="play-first"]:checked').val();
        socket_send('START ' + variant + ' ' + level + ' ' + pf);
    }
    function restart_game() {
        tbl_board.classList.remove('playing', 'thinking');
        set_panel_state(false);
    }
    function undo_game() {
        socket_send('UNDO');
    }
    function set_panel_state(play) {
        if (play) return;
        // Config state: clear board, ready for a new game
        if (ksh_send_input_string) btn_start.prop('disabled', false);
        btn_restart.prop('disabled', true);
        btn_undo.prop('disabled', true);
        btn_showmoves.hide(0); btn_prevmove.hide(0); btn_nextmove.hide(0);
        tbl_board.classList.remove('playing', 'thinking');
        panel_gamearea.classList.remove('started');
        set_options_enabled(true);
        draw_empty_board();
        game_status.text('Pick options, then Start.');
    }
    function game_showmoves() {
        btn_showmoves.hide(200);
        $('#btn_prevmove, #btn_nextmove').show(200);
        render_board(null, null, { disp_num: true });
        cur_reply_cnt = move_cnt;
    }
    function game_prevmove() {
        if (cur_reply_cnt > 0) {
            cur_reply_cnt--;
            var move = board_history[cur_reply_cnt];
            render_board([{ x: move.x, y: move.y, change: { empty: true } }]);
        }
    }
    function game_nextmove() {
        if (cur_reply_cnt < move_cnt) {
            var move = board_history[cur_reply_cnt];
            render_board([{ x: move.x, y: move.y, change: { empty: false } }]);
            cur_reply_cnt++;
        }
    }

    document.onkeydown = function (e) {
        var enable = btn_prevmove.css('display') !== 'none';
        switch (e.keyCode) {
            case 37: // left
            case 38: // up
                if (enable) { game_prevmove(); e.preventDefault(); }
                break;
            case 39: // right
            case 40: // down
                if (enable) { game_nextmove(); e.preventDefault(); }
                break;
        }
    };
    // END GAME

    // === BOARD ===
    var COL_LABELS = 'ABCDEFGHIJKLMNOPQRST';
    var STAR_POINTS = { '3,3': 1, '3,11': 1, '7,7': 1, '11,3': 1, '11,11': 1 };

    var tbl_board = document.getElementById('tbl_board');
    var div_gamearea = document.getElementById('div_gamearea');

    function is_star(x, y) {
        return STAR_POINTS[x + ',' + y] === 1;
    }

    function render_cell(x, y) {
        var cell = tbl_board.rows[x].cells[y];
        var data = board[x][y];
        var cls = 'cell';
        if (is_star(x, y)) cls += ' star';

        if (data.empty) {
            cell.className = cls + (data.undo_move ? ' undo' : ' empty');
            cell.innerHTML = '';
            return;
        }

        var pcls = 'piece p' + data.piece;
        if (data.win_move) pcls += ' win';
        if (data.new_move) cls += ' lastcell';
        if (data.win_move) cls += ' wincell';
        var num = (data.disp_num && data.move_num) ? '<span class="num">' + data.move_num + '</span>' : '';
        cell.className = cls + ' filled';
        cell.innerHTML = '<span class="' + pcls + '">' + num + '</span>';
    }
    function apply_update(up) {
        if (!up) return;
        up.forEach(function (elem) {
            var data = board[elem.x][elem.y];
            for (var name in elem.change) { data[name] = elem.change[name]; }
            render_cell(elem.x, elem.y);
        });
    }
    function render_board(update, update_defer, change_all) {
        //console.log(update, update_defer);
        apply_update(board_update_defer);
        apply_update(update);
        board_update_defer = update_defer;

        if (change_all) {
            if (typeof change_all === 'object') {
                for (var r = 0; r < board_size; r++)
                    for (var c = 0; c < board_size; c++)
                        for (var name in change_all)
                            board[r][c][name] = change_all[name];
                //console.log(board);
            }
            rerender_all();
        }
    }
    function rerender_all() {
        for (var r = 0; r < board_size; r++)
            for (var c = 0; c < board_size; c++)
                render_cell(r, c);
    }

    function init_board() {
        // Cell size: leave room for the coordinate strips, clamp for readability
        var container_size = panel_gamearea.offsetWidth - 56;
        var cell_size = Math.floor(container_size / board_size);
        cell_size -= cell_size % 2;
        if (cell_size < 20) cell_size = 20;
        if (cell_size > 42) cell_size = 42;

        // Column labels (A..O)
        lbl_cols.innerHTML = '';
        for (var c = 0; c < board_size; c++) {
            var sc = document.createElement('span');
            sc.style.width = cell_size + 'px';
            sc.textContent = COL_LABELS[c];
            lbl_cols.appendChild(sc);
        }

        // Row labels (1..15)
        lbl_rows.innerHTML = '';
        for (var r = 0; r < board_size; r++) {
            var sr = document.createElement('span');
            sr.style.height = cell_size + 'px';
            sr.textContent = (r + 1);
            lbl_rows.appendChild(sr);
        }

        // Board cells
        tbl_board.innerHTML = '';
        for (var br = 0; br < board_size; br++) {
            var row = tbl_board.insertRow();
            for (var bc = 0; bc < board_size; bc++) {
                var cell = row.insertCell();
                cell.r = br; cell.c = bc;
                cell.style.width = cell_size + 'px';
                cell.style.height = cell_size + 'px';
                cell.style.padding = '0';
                cell.addEventListener('click', tblBoardOnClick);
            }
        }
    }

    function tblBoardOnClick(e) {
        if (!tbl_board.classList.contains('playing')) return;
        var r = e.currentTarget.r, c = e.currentTarget.c;
        socket_send("HM " + r + " " + c);
    }

    $(window).resize(function () {
        init_board();
        rerender_all();
    });

    // END BOARD

    function offerFileAsDownload(filename, mime) {
        mime = mime || 'application/octet-stream';

        let content = FS.readFile(filename);
        console.log('Offering download of ' + filename + ', with ' + content.length + ' bytes...');

        var a = document.createElement('a');
        a.download = 'ksh.csv';
        a.href = URL.createObjectURL(new Blob([content], { type: mime }));
        a.style.display = 'none';

        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        }, 2000);
    }

    $('#btn_download_logs').hide().click(function (event) {
        event.preventDefault();
        if (FS) {
            offerFileAsDownload('/persistent_data/ksh.csv', 'text/csv');
        }
    });

    set_panel_state(false);
});
