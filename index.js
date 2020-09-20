const HTTP = require("http");
const HTTPS = require("https");
const ChildProcess = require("child_process");

const captcha_renex_site_key = "6LfSWqkZAAAAAEkwPYmrpzgjwivDtoJBkybcK7v-";
const captcha_server_port = 53024;
const captcha_fake_subdomain = "auto";

const desired_origin = "LEIRIA";
const desired_destination = "LISBOA SETE RIOS";
const desired_date = new Date(2020, 9 - 1, 24, 13, 30);
const desired_seat = parseInt(process.argv[2]);

let origins = [];

////////////////////////////////////////////////
async function gen_captcha_token(action)
{
    return new Promise(
        function (resolve, reject)
        {
            // Check for our fake subdomain in the hosts file, if it's not there, add it
            ChildProcess.exec(
                "nslookup " + captcha_fake_subdomain + ".rede-expressos.pt",
                function (e, stdout, stderr)
                {
                    if(e && e.code == 1 && stdout && stdout.indexOf("** server can't find " + captcha_fake_subdomain + ".rede-expressos.pt: NXDOMAIN") !== -1)
                    {
                        ChildProcess.execSync("echo \"\" >> /etc/hosts");
                        ChildProcess.execSync("echo \"# Used by renex-intf\" >> /etc/hosts");
                        ChildProcess.execSync("echo \"127.0.0.1\t" + captcha_fake_subdomain + ".rede-expressos.pt\" >> /etc/hosts");
                    }
                }
            );

            // grecaptcha token generation HTML/JS
            let html = `<!DOCTYPE html>
                        <html>
                        <body>
                        <p id="g-recaptcha-response">Waiting...</p>
                        <script src="https://www.google.com/recaptcha/api.js?render=` + captcha_renex_site_key + `"></script>
                        <script>
                            window.grecaptcha.ready(
                                function()
                                {
                                    document.getElementById('g-recaptcha-response').innerHTML = "Ready. Fetching...";

                                    window.grecaptcha.execute("` + captcha_renex_site_key + `", {action: "` + action + `"}).then(
                                        function(token)
                                        {
                                            document.getElementById('g-recaptcha-response').innerHTML = token;

                                            var xhttp = new XMLHttpRequest();
                                            xhttp.open("POST", "token", true);
                                            xhttp.send(token);
                                        }
                                    );
                                }
                            );
                        </script>
                        </body>
                        </html>`;

            // Create an HTTP server to serve the above HTML and to receive the generated token
            let firefox;
            let firefox_timeout;
            let server = HTTP.createServer(
                function (req, res)
                {
                    req.body = [];

                    req.on(
                        "data",
                        function (chunk)
                        {
                            req.body.push(chunk);
                        }
                    );

                    req.on(
                        "end",
                        function ()
                        {
                            req.body = Buffer.concat(req.body);

                            if(req.url == "/token" && req.body !== "")
                            {
                                firefox.on(
                                    "close",
                                    function ()
                                    {
                                        resolve(req.body.toString());
                                    }
                                );

                                if(firefox_timeout)
                                    clearTimeout(firefox_timeout);

                                firefox.kill("SIGINT");
                                server.close();
                            }

                            res.end(html);
                        }
                    )
                }
            );

            server.listen(captcha_server_port);

            function open_firefox()
            {
                firefox = ChildProcess.spawn("firefox", ["--headless", "http://" + captcha_fake_subdomain + ".rede-expressos.pt:" + captcha_server_port]);

                firefox_timeout = setTimeout(
                    function ()
                    {
                        console.log("Timed out waiting for captcha token, retrying...");

                        firefox.on(
                            "close",
                            function ()
                            {
                                ChildProcess.execSync("rm -rf ~/.mozilla");

                                return open_firefox();
                            }
                        );

                        firefox.kill("SIGINT");
                    },
                    30000
                );
            }

            open_firefox();
        }
    );
}
function gen_browser_token()
{
    let result = "";
    let characters = "abcdef0123456789";

    for(let i = 0; i < 32; i++)
    {
        result += characters.charAt(Math.floor(Math.random() * characters.length));

        if(i == 7 || i == 11 || i == 15 || i == 19)
            result += "-";
    }

    return result;
}
function is_seat_free(map, seat)
{
    for(let i = 0; i < map.length; i++)
    {
        if(seat >= map[i].first && seat <= map[i].last)
            return true;
    }

    return false;
}
async function sleep(ms)
{
    return new Promise(resolve => setTimeout(resolve, ms));
}
////////////////////////////////////////////////
async function https_request(options, body)
{
    return new Promise(
        function (resolve, reject)
        {
            const req = HTTPS.request(
                options,
                function (res)
                {
                    res.body = [];

                    res.on('data',
                        function (chunk)
                        {
                            res.body.push(chunk);
                        }
                    );

                    res.on('end',
                        function()
                        {
                            res.body = Buffer.concat(res.body);

                            return resolve(res);
                        }
                    );
                }
            )

            req.on("error", reject);

            if(body)
                req.write(body);

            req.end();
        }
    );
}

async function fetch_origins(browser_token, national, international)
{
    let payload = {
        national: national,
        international: international
    };

    let req_body = JSON.stringify(payload);
    let req_options = {
        host: "www.rede-expressos.pt",
        port: 443,
        path: "/api/locations/origins",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    let res = await https_request(req_options, req_body);

    if(res.statusCode != 200)
    {
        let body = undefined;

        try
        {
            body = JSON.parse(res.body);
        }
        catch (e)
        {
        }

        let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

        if(body)
            e.details = body;

        throw e;
    }

    if(!res.body)
        throw new Error("Invalid body");

    return JSON.parse(res.body);
}
async function fetch_destinations(browser_token, origin_id, national, international)
{
    let payload = {
        national: national,
        international: international,
        originId: origin_id.toString()
    };

    let req_body = JSON.stringify(payload);
    let req_options = {
        host: "www.rede-expressos.pt",
        port: 443,
        path: "/api/locations/destinations",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    let res = await https_request(req_options, req_body);

    if(res.statusCode != 200)
    {
        let body = undefined;

        try
        {
            body = JSON.parse(res.body);
        }
        catch (e)
        {
        }

        let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

        if(body)
            e.details = body;

        throw e;
    }

    if(!res.body)
        throw new Error("Invalid body");

    return JSON.parse(res.body);
}
async function fetch_ticket_schedules(browser_token, rflex_id, origin_id, destination_id, outgoing_date, passengers)
{
    let payload = {
        captcha: await gen_captcha_token("ticketing/schedules"),
        rflexNr: rflex_id > 0 ? rflex_id.toString : "",
        jsonInput: {
            idOrigin: origin_id.toString(),
            idDestination: destination_id.toString(),
            dateIda: outgoing_date.toISOString(),
            passengerList: passengers.length ? passengers : [passengers]
        },
        refresh: true
    };

    let req_body = JSON.stringify(payload);
    let req_options = {
        host: "www.rede-expressos.pt",
        port: 443,
        path: "/api/ticketing/schedules",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    let res = await https_request(req_options, req_body);

    if(res.statusCode != 200)
    {
        let body = undefined;

        try
        {
            body = JSON.parse(res.body);
        }
        catch (e)
        {
        }

        let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

        if(body)
            e.details = body;

        throw e;
    }

    if(!res.body)
        throw new Error("Invalid body");

    return JSON.parse(res.body);
}
async function create_reservation(browser_token, outgoing_schedule, return_schedule, passengers)
{
    let payload = {
        captcha: await gen_captcha_token("reservation/create"),
        jsonInput: {
            outgoing_schedule: outgoing_schedule.schedule_id.toString(),
            outgoing_date: outgoing_schedule.departure_date.toISOString(),
            return_schedule: return_schedule ? return_schedule.schedule_id.toString() : null,
            return_date: return_schedule ? return_schedule.departure_date.toISOString() : null,
            passengers: passengers.length ? passengers : [passengers]
        },
        recover: null
    };

    let req_body = JSON.stringify(payload);
    let req_options = {
        host: "www.rede-expressos.pt",
        port: 443,
        path: "/api/reservation/create",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    let res = await https_request(req_options, req_body);

    if(res.statusCode != 200)
        throw new Error("Request unsuccessfull (" + res.statusCode + ")");

    if(!res.body)
        throw new Error("Invalid body");

    res.body = res.body.toString("utf8"); // Response is plain text, some kind of token (looks like base64 but decoding yields garbage)
    res.body = res.body.substr(1, res.body.length - 2); // Remove quotes at the start and end

    if(!res.body)
        throw new Error("Malformated response");

    return res.body;
}
async function get_reservation_details(browser_token, reservation_token)
{
    let payload = {
        Id: reservation_token
    };

    let req_body = JSON.stringify(payload);
    let req_options = {
        host: "www.rede-expressos.pt",
        port: 443,
        path: "/api/reservation/details",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    let res = await https_request(req_options, req_body);

    if(res.statusCode != 200)
    {
        let body = undefined;

        try
        {
            body = JSON.parse(res.body);
        }
        catch (e)
        {
        }

        let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

        if(body)
            e.details = body;

        throw e;
    }

    if(!res.body)
        throw new Error("Invalid body");

    return JSON.parse(res.body);
}
async function get_seat_list(browser_token, reservation_id)
{
    let req_options = {
        host: "www.rede-expressos.pt",
        port: 443,
        path: "/api/bookings/seats/get?reservationId=" + reservation_id,
        method: "GET",
        headers: {
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    let res = await https_request(req_options);

    if(res.statusCode != 200)
    {
        let body = undefined;

        try
        {
            body = JSON.parse(res.body);
        }
        catch (e)
        {
        }

        let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

        if(body)
            e.details = body;

        throw e;
    }

    if(!res.body)
        throw new Error("Invalid body");

    return JSON.parse(res.body);
}
async function change_seat(browser_token, reservation_id, outgoing_leg, return_leg, current_seat, new_seat)
{
    let payload = {
        reservationId: reservation_id,
        jsonInput: []
    };

    current_seat = current_seat.length ? current_seat : [current_seat];
    new_seat = new_seat.length ? new_seat : [new_seat];

    for(let i = 0; i < current_seat.length; i++)
    {
        payload.jsonInput[i] = {
            outgoing_leg_no: outgoing_leg, // Trip branch (if there is need to switch buses)
            return_leg_no: return_leg,
            current_seat_no: current_seat[i],
            new_seat_no: new_seat[i],
            passenger_id: i + 1
        }
    }

    let req_body = JSON.stringify(payload);
    let req_options = {
        host: "www.rede-expressos.pt",
        port: 443,
        path: "/api/bookings/seats/change",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    let res = await https_request(req_options, req_body);

    if(res.statusCode != 200)
    {
        let body = undefined;

        try
        {
            body = JSON.parse(res.body);
        }
        catch (e)
        {
        }

        let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

        if(body)
            e.details = body;

        throw e;
    }

    if(!res.body)
        throw new Error("Invalid body");

    return JSON.parse(res.body);
}
////////////////////////////////////////////////

async function main()
{
    let browser_token = gen_browser_token();

    console.log("Generated browser token: " + browser_token);

    let fetched_origins = undefined;

    console.log("Fetching origins...");

    try
    {
        fetched_origins = await fetch_origins(browser_token, true, false);

        console.log("Fetched " + fetched_origins.length + " origins!");
    }
    catch (e)
    {
        console.error("Error fetching origins!");
        console.error(e.stack);

        if(e.details)
            console.error(e.details);

        return;
    }

    let desired_origin_id = undefined;

    for(let i = 0; i < fetched_origins.length; i++)
    {
        //console.log(fetched_origins[i].id + " - " + fetched_origins[i].name);

        origins[i] = {
            id: parseInt(fetched_origins[i].id),
            name: fetched_origins[i].name
        };

        if(fetched_origins[i].name === desired_origin)
        {
            desired_origin_id = parseInt(fetched_origins[i].id);

            break;
        }
    }

    if(desired_origin_id === undefined)
        return console.error("Desired origin not found!");

    console.log("Found origin '" + desired_origin + "'. ID: " + desired_origin_id);

    let fetched_destinations = undefined;

    console.log("Fetching destinations for '" + desired_origin + "'...");

    try
    {
        fetched_destinations = await fetch_destinations(browser_token, desired_origin_id, true, false);

        console.log("Fetched " + fetched_destinations.length + " destinations!");
    }
    catch (e)
    {
        console.error("Error fetching destinations!");
        console.error(e.stack);

        if(e.details)
            console.error(e.details);

        return;
    }

    let desired_destination_id = undefined;

    for(let i = 0; i < fetched_destinations.length; i++)
    {
        //console.log(fetched_destinations[i].id + " - " + fetched_destinations[i].name);

        if(fetched_destinations[i].name == desired_destination)
        {
            desired_destination_id = parseInt(fetched_destinations[i].id);

            break;
        }
    }

    if(desired_destination_id === undefined)
        return console.error("Desired destination not found!");

    console.log("Found destination '" + desired_destination + "'. ID: " + desired_destination_id);

    let passenger = {
        fare_type_id: "1",
        name: "",
        email: "",
        doc: "",
        promocode: "", // RFLEX ID
        id: 1
    };

    let fetched_schedules = undefined;

    console.log("Fetching ticket schedules for '" + desired_origin + "' > '" + desired_destination + "' on " + desired_date.toString() + "...");

    try
    {
        fetched_schedules = await fetch_ticket_schedules(browser_token, null, desired_origin_id, desired_destination_id, desired_date, passenger);

        if(!fetched_schedules.length || !fetched_schedules[0] || !fetched_schedules[0].outgoing_schedules)
            return console.error("Malformated response");

        fetched_schedules = fetched_schedules[0].outgoing_schedules;

        console.log("Fetched " + fetched_schedules.length + " schedules!");
    }
    catch (e)
    {
        console.error("Error fetching schedules!");
        console.error(e.stack);

        if(e.details)
            console.error(e.details);

        return;
    }

    let desired_schedule = undefined;
    let min_schedule_difference = Infinity;

    for(let i = 0; i < fetched_schedules.length; i++)
    {
        //console.log(require("util").inspect(fetched_schedules[i], {showHidden: false, depth: null}))

        fetched_schedules[i].departure_date = new Date(
            parseInt(fetched_schedules[i].date.substr(0, 4)),
            parseInt(fetched_schedules[i].date.substr(5, 2)) - 1,
            parseInt(fetched_schedules[i].date.substr(8, 2)),
            parseInt(fetched_schedules[i].departure_time.substr(0, 2)),
            parseInt(fetched_schedules[i].departure_time.substr(3, 2))
        );

        fetched_schedules[i].arrival_date = new Date(
            parseInt(fetched_schedules[i].date.substr(0, 4)),
            parseInt(fetched_schedules[i].date.substr(5, 2)) - 1,
            parseInt(fetched_schedules[i].date.substr(8, 2)),
            parseInt(fetched_schedules[i].arrival_time.substr(0, 2)),
            parseInt(fetched_schedules[i].arrival_time.substr(3, 2))
        );

        let schedule_difference = Math.abs(desired_date.getTime() - fetched_schedules[i].departure_date.getTime());

        if(schedule_difference < min_schedule_difference)
        {
            min_schedule_difference = schedule_difference;

            desired_schedule = fetched_schedules[i];
        }
    }

    if(desired_schedule === undefined)
        return console.error("No schedule found!");

    console.log("Found schedule departing on " + desired_schedule.departure_date.toString() + " and arriving on " + desired_schedule.arrival_date.toString() + ". ID: " + desired_schedule.schedule_id);

    while(desired_schedule.departure_date.getTime() > new Date().getTime())
    {
        browser_token = gen_browser_token();

        console.log("Generated browser token: " + browser_token);

        let reservation_token = undefined;

        while(reservation_token === undefined)
        {
            console.log("Creating reservation for schedule '" + desired_schedule.schedule_id + "'...");

            try
            {
                reservation_token = await create_reservation(browser_token, desired_schedule, null, passenger);

                console.log("Created reservation!");
            }
            catch (e)
            {
                console.error("Error creating reservation!");
                console.error(e.stack);

                if(e.details)
                    console.error(e.details);

                await sleep(1000);

                continue;
            }
        }

        let reservation_id = undefined;

        while(reservation_id === undefined)
        {
            console.log("Getting reservation details...");

            try
            {
                reservation_details = await get_reservation_details(browser_token, reservation_token);

                //console.log(require("util").inspect(reservation_details, {showHidden: false, depth: null}))

                reservation_id = reservation_details.reservationId;

                console.log("Reservation ID: " + reservation_id);
            }
            catch (e)
            {
                console.error("Error getting reservation details!");
                console.error(e.stack);

                if(e.details)
                    console.error(e.details);

                await sleep(1000);

                continue;
            }
        }

        while(true)
        {
            let expired_reservation = false;
            let seat_details = undefined;

            while(seat_details === undefined)
            {
                console.log("Getting seat details...");

                try
                {
                    seat_details = await get_seat_list(browser_token, reservation_id);

                    //console.log(require("util").inspect(seat_details, {showHidden: false, depth: null}))

                    if(!seat_details.outgoing_itinerary ||
                        !seat_details.outgoing_itinerary.legs ||
                        !seat_details.outgoing_itinerary.legs.length ||
                        !seat_details.outgoing_itinerary.legs[0].available_seats ||
                        !seat_details.outgoing_itinerary.legs[0].assigned_seats ||
                        !seat_details.outgoing_itinerary.legs[0].assigned_seats.length)
                    {
                        console.log("Expired reservation!");

                        expired_reservation = true;

                        break;
                    }
                }
                catch (e)
                {
                    if(e.details && e.details.error === "ERROR_API_0" && !e.details.errorDetails)
                    {
                        console.log("Expired reservation!");

                        expired_reservation = true;

                        break;
                    }

                    console.error("Error getting seat details!");
                    console.error(e.stack);

                    if(e.details)
                        console.error(e.details);

                    await sleep(1000);

                    continue;
                }
            }

            if(expired_reservation)
                break;

            let seat_map = seat_details.outgoing_itinerary.legs[0].available_seats;
            let current_seat = seat_details.outgoing_itinerary.legs[0].assigned_seats[0].seat_no;

            console.log("Got current seat: " + current_seat);

            if(current_seat != desired_seat)
            {
                if(!is_seat_free(seat_map, desired_seat))
                {
                    console.log("Desired seat is not free!");
                }
                else
                {
                    let seat_changed = false;

                    while(!seat_changed)
                    {
                        console.log("Changing current seat " + current_seat + " to " + desired_seat);

                        try
                        {
                            await change_seat(browser_token, reservation_id, 1, null, current_seat, desired_seat);

                            seat_changed = true;

                            //console.log(require("util").inspect(result, {showHidden: false, depth: null}))
                        }
                        catch (e)
                        {
                            console.error("Error changing seat!");
                            console.error(e.stack);

                            if(e.details)
                                console.error(e.details);

                            await sleep(1000);

                            continue;
                        }
                    }
                }

                await sleep(1000);
            }
            else
            {
                await sleep(5000);
            }
        }
    }
}

main();
