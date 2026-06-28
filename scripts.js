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

    function server_start() {
        set_panel_state(true);
        btn_start.prop('disabled', false);
        btn_restart.prop('disabled', false);
        btn_undo.prop('disabled', false);
        btn_showmoves.hide(0); btn_prevmove.hide(0); btn_nextmove.hide(0);

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
        set_panel_state(false);
    }
    function undo_game() {
        socket_send('UNDO');
    }
    function set_panel_state(play) {
        (!play ? $('#row_play') : $('#row_setting')).hide(400);
        (play ? $('#row_play') : $('#row_setting')).show(400, function () {
            if (play) {
                $('html, body').animate({
                    scrollTop: $("#row_play").offset().top
                }, 200);
            }
        });
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
    // Preset graphics
    var svg_lines = [
        '<line x1="50%" y1="0" x2="50%" y2="50%" style="stroke:rgb(110,110,110); stroke-width:2px;" />',
        '<line x1="0" y1="50%" x2="50%" y2="50%" style="stroke:rgb(110,110,110); stroke-width:2px;" />',
        '<line x1="50%" y1="50%" x2="50%" y2="100%" style="stroke:rgb(110,110,110); stroke-width:2px;" />',
        '<line x1="50%" y1="50%" x2="100%" y2="50%" style="stroke:rgb(110,110,110); stroke-width:2px;" />',

        '<line x1="35%" y1="50%" x2="65%" y2="50%" style="stroke:rgb(255,0,0); stroke-width:2px;" />' +
        '<line x1="50%" y1="35%" x2="50%" y2="65%" style="stroke:rgb(255,0,0); stroke-width:2px;" />'
    ];
    var svg_circles = [
        //'<circle cx="50%" cy="50%" r="32%" fill="#fff" />',
        //'<circle cx="50%" cy="50%" r="32%" fill="#333" />'
        '<use xlink:href="#white_piece" />',
        '<use xlink:href="#black_piece" />'
    ];
    var svg_newmove = [
        '<line x1="35%" y1="50%" x2="65%" y2="50%" style="stroke:#777; stroke-width:2px;" />' +
        '<line x1="50%" y1="35%" x2="50%" y2="65%" style="stroke:#777; stroke-width:2px;" />',
        '<line x1="35%" y1="50%" x2="65%" y2="50%" style="stroke:#e2e2e2; stroke-width:2px;" />' +
        '<line x1="50%" y1="35%" x2="50%" y2="65%" style="stroke:#e2e2e2; stroke-width:2px;" />',
    ];
    var svg_number = [
        '<text x="50%" y="52%" fill="#333" alignment-baseline="middle" text-anchor="middle" font-weight="bold">',
        '<text x="50%" y="52%" fill="#fff" alignment-baseline="middle" text-anchor="middle" font-weight="bold">'
    ];
    var colors = ['#bbb', '#777', '#eee'];

    var tbl_board = document.getElementById('tbl_board');
    var div_gamearea = document.getElementById('div_gamearea');

    function render_cell(x, y) {
        var cell = tbl_board.rows[x].cells[y];
        var data = board[x][y];
        var svg = '<svg style="display: block; width: 100%; height: 100%;" ' +
            'xmlns:svg="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" ' +
            'xmlns:xlink="http://www.w3.org/1999/xlink">';

        // Grid (lines)
        if (x > 0) svg += svg_lines[0];
        if (y > 0) svg += svg_lines[1];
        if (x < board_size - 1) svg += svg_lines[2];
        if (y < board_size - 1) svg += svg_lines[3];

        // Inner content
        if (!data.empty) {
            if (data.piece) svg += svg_circles[data.piece - 1];
            if (data.win_move) svg += svg_lines[4];
            if (data.new_move) svg += svg_newmove[data.piece - 1];
            if (data.piece && data.move_num && data.disp_num)
                svg += svg_number[data.piece - 1] + data.move_num + '</text>';
        }
        if (data.undo_move) svg += svg_lines[4];

        // Update node
        cell.innerHTML = svg + '</svg>';
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
        // Automatically adjust display size
        var container_size = panel_gamearea.offsetWidth - 32;

        // Control table size with cell size
        var cell_width = Math.floor(container_size / board_size);
        var cell_height = Math.floor(container_size / board_size);

        // No more blurry
        cell_width -= cell_width % 2;
        cell_height -= cell_height % 2;

        // Set containing div size
        div_gamearea.style.width = cell_width * board_size + 'px';
        div_gamearea.style.height = cell_height * board_size + 'px';

        // Initialize tbl_board
        tbl_board.innerHTML = "";
        for (var r = 0; r < board_size; r++) {
            var row = tbl_board.insertRow();
            for (var c = 0; c < board_size; c++) {
                // New cell and data
                var cell = row.insertCell();
                cell.r = r; cell.c = c;
                cell.board_data = 0;

                // Style
                cell.width = cell_width; cell.height = cell_height;
                cell.style.padding = '0';
                cell.style.verticalAlign = 'bottom';

                // Handle click event
                cell.addEventListener("click", tblBoardOnClick);
            }
        }
    }

    function tblBoardOnClick(e) {
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

    $('#row_setting, #row_play').hide();
    set_panel_state(false);
});
